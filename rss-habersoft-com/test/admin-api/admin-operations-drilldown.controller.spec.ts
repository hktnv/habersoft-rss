import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { ApiModule } from "../../src/api.module";
import { hashAdminPassword } from "../../src/admin-auth/admin-password-hash";
import type { RuntimeConfig } from "../../src/configuration/runtime-config";
import { PostgresService } from "../../src/persistence/postgres.service";
import { RedisService } from "../../src/redis/redis.service";
import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

class FakeRedisCommand {
  public readonly store = new Map<string, string>();

  public call(command: string, ...args: readonly string[]): Promise<string | number | null> {
    switch (command) {
      case "SET":
        this.store.set(args[0] ?? "", args[1] ?? "");
        return Promise.resolve("OK");
      case "GET":
        return Promise.resolve(this.store.get(args[0] ?? "") ?? null);
      case "DEL":
        this.store.delete(args[0] ?? "");
        return Promise.resolve(1);
      default:
        return Promise.reject(new Error(`unsupported redis command ${command}`));
    }
  }
}

describe("Admin operations drilldown API", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let redis: FakeRedisCommand;
  let database: ReturnType<typeof fakeDatabase>;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("fails closed without admin auth configured", async () => {
    await boot({ ...runtimeConfig, adminAuth: { mode: "disabled" } });

    const response = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/drilldown"
    });

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.payload)).toEqual({
      configured: false,
      authenticated: false,
      reason: "not_configured",
      message: "Admin authentication is not configured."
    });
    expect(database.feed.count).not.toHaveBeenCalled();
  });

  it("requires an authenticated admin session before returning bounded drilldown data", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const unauthenticated = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/drilldown"
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.payload).not.toContain("rows");
    expect(database.feed.count).not.toHaveBeenCalled();

    const login = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "test-only-admin-password" }
    });
    expect(login.statusCode).toBe(200);
    const cookie = cookiePair(login.headers["set-cookie"]);

    const drilldown = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/drilldown?ignored=true",
      headers: {
        cookie
      }
    });
    expect(drilldown.statusCode).toBe(200);
    expect(drilldown.headers["cache-control"]).toContain("no-store");
    const body = asRecord(JSON.parse(drilldown.payload) as unknown);
    expect(body.status).toBe("ok");
    expect(body.window).toEqual({ recentHours: 24, maxRows: 20 });

    const feeds = asRecord(body.feeds);
    expect(feeds.status).toBe("ok");
    expect(feeds.total).toBe(1);
    expect(feeds.active).toBe(1);
    expect(feeds.due).toBe(1);
    expect(feeds.withRecentSuccess).toBe(1);
    expect(feeds.withRecentFailure).toBe(1);
    const feedRows = feeds.rows as readonly unknown[];
    expect(feedRows).toHaveLength(1);
    const firstFeed = asRecord(feedRows[0]);
    expect(firstFeed.displayId).toMatch(/^feed_[a-f0-9]{10}$/u);
    expect(firstFeed.displayName).toBe("Example News");
    expect(firstFeed.sourceHost).toBe("news.example.org");
    expect(firstFeed.health).toBe("degraded");
    expect(firstFeed.lastResult).toBe("failure");
    expect(firstFeed.recentEntryCount).toBe(3);

    const ingestion = asRecord(body.ingestion);
    expect(ingestion.status).toBe("ok");
    expect(ingestion.recentEntryCount).toBe(3);
    expect(ingestion.recentBatchCount).toBe(2);
    expect(ingestion.latestEntryAt).toBe("2026-06-30T05:55:00.000Z");
    const ingestionRows = ingestion.rows as readonly unknown[];
    expect(ingestionRows.length).toBeLessThanOrEqual(20);
    const firstIngestion = asRecord(ingestionRows[0]);
    expect(firstIngestion.displayId).toMatch(/^check_[a-f0-9]{10}$/u);
    expect(firstIngestion.feedDisplayId).toMatch(/^feed_[a-f0-9]{10}$/u);
    expect(firstIngestion.entryCount).toBe(2);

    expect(drilldown.payload).toContain("news.example.org");
    expect(drilldown.payload).not.toContain("https://news.example.org/feed.xml");
    expect(drilldown.payload).not.toContain("raw-check-id");
    expect(drilldown.payload).not.toContain("entry body");
    expect(drilldown.payload).not.toContain("AGENT_KEY");
    expect(drilldown.payload).not.toContain("DATABASE_URL");
    expectNoWrites(database);
  });

  it("keeps admin-api drilldown read-only and exact-route scoped", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const post = await fastify.inject({
      method: "POST",
      url: "/admin-api/operations/drilldown",
      payload: { mutate: true }
    });
    expect(post.statusCode).toBe(405);
    expect(post.payload).not.toContain("rows");

    const unknown = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/drilldown/extra"
    });
    expect(unknown.statusCode).toBe(404);
    expectNoWrites(database);
  });

  it("returns partial safe notes when a drilldown section is unavailable", async () => {
    await boot(singleAdminConfig("test-only-admin-password"), fakeDatabase({ feedUnavailable: true }));
    const login = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "test-only-admin-password" }
    });
    const cookie = cookiePair(login.headers["set-cookie"]);

    const response = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/drilldown",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = asRecord(JSON.parse(response.payload) as unknown);
    expect(body.status).toBe("partial");
    expect(asRecord(body.feeds).status).toBe("unavailable");
    expect(asRecord(body.ingestion).status).toBe("ok");
    expect(response.payload).toContain("Feed drilldown metrics are temporarily unavailable");
    expect(response.payload).not.toContain("database exploded");
    expect(response.payload).not.toContain("stack");
  });

  async function boot(config: RuntimeConfig, databaseOverride?: ReturnType<typeof fakeDatabase>): Promise<void> {
    redis = new FakeRedisCommand();
    database = databaseOverride ?? fakeDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule.register(config)]
    })
      .overrideProvider(JwksCacheService)
      .useValue({
        readiness: jest.fn().mockReturnValue({
          status: "up",
          keyCount: 1,
          lastSuccessfulRefreshAt: new Date("2026-06-20T00:00:00.000Z"),
          lastFailureReason: null
        }),
        getKey: jest.fn()
      })
      .overrideProvider(RedisService)
      .useValue({
        check: jest.fn().mockResolvedValue("up"),
        command: () => redis
      })
      .overrideProvider(PostgresService)
      .useValue({
        check: jest.fn().mockResolvedValue("up"),
        database: jest.fn().mockReturnValue(database)
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  }
});

function fakeDatabase(options: { readonly feedUnavailable?: boolean } = {}) {
  const writes = {
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn()
  };

  const feedCount = options.feedUnavailable
    ? jest.fn().mockRejectedValue(new Error("database exploded"))
    : jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1);

  return {
    feed: {
      ...writes,
      count: feedCount,
      findMany: jest.fn().mockResolvedValue([
        {
          id: 101n,
          url: "https://news.example.org/feed.xml?private=1",
          title: "Example News",
          active: true,
          lastCheckedAt: new Date("2026-06-30T05:00:00.000Z"),
          lastHttpStatus: 503,
          errorCount: 1,
          nextCheckAt: new Date("2026-06-30T05:30:00.000Z")
        }
      ])
    },
    entry: {
      ...writes,
      count: jest.fn().mockResolvedValue(3),
      groupBy: jest.fn().mockResolvedValue([
        {
          feedId: 101n,
          _count: {
            _all: 3
          }
        }
      ]),
      findFirst: jest.fn().mockResolvedValue({ createdAt: new Date("2026-06-30T05:55:00.000Z") })
    },
    agentFeedCheckEvent: {
      ...writes,
      count: jest.fn().mockResolvedValue(2),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ feedId: 101n }])
        .mockResolvedValueOnce([{ feedId: 101n }]),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          {
            checkId: "raw-check-id-1",
            feedId: 101n,
            checkedAt: new Date("2026-06-30T05:45:00.000Z"),
            createdAt: new Date("2026-06-30T05:45:05.000Z"),
            outcome: "entries_found",
            entriesSubmittedCount: 2,
            entriesSavedCount: 2,
            errorCode: null,
            httpStatus: 200
          },
          {
            checkId: "raw-check-id-2",
            feedId: 101n,
            checkedAt: new Date("2026-06-30T04:45:00.000Z"),
            createdAt: new Date("2026-06-30T04:45:05.000Z"),
            outcome: "fetch_error",
            entriesSubmittedCount: 0,
            entriesSavedCount: 0,
            errorCode: "FETCH_ERROR",
            httpStatus: 503
          }
        ])
        .mockResolvedValueOnce([
          {
            feedId: 101n,
            checkedAt: new Date("2026-06-30T04:45:00.000Z"),
            outcome: "fetch_error",
            entriesSubmittedCount: 0,
            entriesSavedCount: 0,
            errorCode: "FETCH_ERROR",
            httpStatus: 503
          }
        ])
    }
  };
}

function singleAdminConfig(password: string): RuntimeConfig {
  return {
    ...runtimeConfig,
    adminAuth: {
      mode: "single_admin",
      username: "admin",
      passwordHash: hashAdminPassword(password, Buffer.from("test-only-salt-00", "utf8")),
      sessionSecret: "test_only_admin_session_secret_at_least_32_bytes",
      sessionTtlSeconds: 900,
      sessionCookieName: "habersoft_admin_session",
      sessionCookieSecure: false,
      redisPrefix: "admin_auth:test"
    }
  };
}

function headerValues(value: string | string[] | number | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function cookiePair(setCookie: string | string[] | number | undefined): string {
  const rootCookie = headerValues(setCookie).find((cookie) => /Path=\//u.test(cookie) && !/Path=\/admin-auth/u.test(cookie));
  return rootCookie?.split(";", 1)[0] ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function expectNoWrites(database: ReturnType<typeof fakeDatabase>): void {
  for (const model of [database.feed, database.entry, database.agentFeedCheckEvent]) {
    expect(model.create).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.delete).not.toHaveBeenCalled();
    expect(model.deleteMany).not.toHaveBeenCalled();
    expect(model.updateMany).not.toHaveBeenCalled();
  }
}
