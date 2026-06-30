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

describe("Admin operations summary API", () => {
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
      url: "/admin-api/operations/summary"
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

  it("requires an authenticated admin session before returning aggregate operations data", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const unauthenticated = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/summary"
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.payload).not.toContain("feeds");
    expect(database.feed.count).not.toHaveBeenCalled();

    const login = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "test-only-admin-password" }
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    expect(headerValues(setCookie)).toEqual(expect.arrayContaining([
      expect.stringContaining("Path=/"),
      expect.stringContaining("Path=/admin-auth")
    ]));
    const cookie = cookiePair(setCookie);

    const summary = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/summary?ignored=true",
      headers: {
        cookie
      }
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.headers["cache-control"]).toContain("no-store");
    const body = asRecord(JSON.parse(summary.payload) as unknown);
    expect(body.status).toBe("ok");
    expect(typeof body.generatedAt).toBe("string");
    expect(body.window).toEqual({ recentHours: 24 });
    expect(body.dependencies).toEqual({ postgres: "up", redis: "up", tenantAuth: "up" });
    expect(body.feeds).toEqual({ total: 12, active: 9, disabled: 3, dueNow: 4 });
    expect(body.entries).toEqual({ total: 40, createdLast24h: 7 });
    expect(body.ingestion).toEqual({
      checksLast24h: 11,
      successLast24h: 8,
      failedLast24h: 2,
      latestCheckAt: "2026-06-30T06:00:00.000Z"
    });
    expect(Array.isArray(body.notes)).toBe(true);
    const firstNote = asRecord((body.notes as readonly unknown[])[0]);
    expect(firstNote.code).toBe("summary_is_aggregate_only");
    expect(String(firstNote.message)).toContain("counts and dependency states only");
    expect(summary.payload).not.toContain("https://feed.example.test");
    expect(summary.payload).not.toContain("entry body");
    expect(summary.payload).not.toContain("AGENT_KEY");
    expect(summary.payload).not.toContain("DATABASE_URL");
  });

  it("keeps admin-api read-only and exact-route scoped", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const post = await fastify.inject({
      method: "POST",
      url: "/admin-api/operations/summary"
    });
    expect(post.statusCode).toBe(405);
    expect(post.payload).not.toContain("feeds");

    const unknown = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/unknown"
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("logout clears root and historical admin-auth cookie paths and blocks the summary", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const login = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "test-only-admin-password" }
    });
    const cookie = cookiePair(login.headers["set-cookie"]);

    const logout = await fastify.inject({
      method: "POST",
      url: "/admin-auth/logout",
      headers: { cookie }
    });
    expect(logout.statusCode).toBe(200);
    expect(headerValues(logout.headers["set-cookie"])).toEqual(expect.arrayContaining([
      expect.stringContaining("Path=/"),
      expect.stringContaining("Path=/admin-auth")
    ]));

    const afterLogout = await fastify.inject({
      method: "GET",
      url: "/admin-api/operations/summary",
      headers: { cookie }
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.payload).not.toContain("feeds");
  });

  async function boot(config: RuntimeConfig): Promise<void> {
    redis = new FakeRedisCommand();
    database = fakeDatabase();
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

function fakeDatabase() {
  const count = jest
    .fn()
    .mockResolvedValueOnce(12)
    .mockResolvedValueOnce(9)
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(40)
    .mockResolvedValueOnce(7)
    .mockResolvedValueOnce(11)
    .mockResolvedValueOnce(8)
    .mockResolvedValueOnce(2);

  return {
    feed: { count },
    entry: { count },
    agentFeedCheckEvent: {
      count,
      findFirst: jest.fn().mockResolvedValue({ checkedAt: new Date("2026-06-30T06:00:00.000Z") })
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
