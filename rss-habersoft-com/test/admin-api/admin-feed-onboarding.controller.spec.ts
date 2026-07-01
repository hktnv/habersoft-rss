import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { ApiModule } from "../../src/api.module";
import { hashAdminPassword } from "../../src/admin-auth/admin-password-hash";
import type { RuntimeConfig } from "../../src/configuration/runtime-config";
import { PostgresService } from "../../src/persistence/postgres.service";
import { RedisService } from "../../src/redis/redis.service";
import { ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID } from "../../src/tenant-feeds/reserved-site-client-ids";
import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type FeedRow = {
  readonly id: bigint;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscriberCount: number;
  readonly nextCheckAt: Date | null;
};

type FeedCreateInput = {
  readonly data: {
    readonly url: string;
    readonly title: string | null;
    readonly active: boolean;
    readonly subscriberCount: number;
    readonly nextCheckAt: Date;
    readonly createdAt: Date;
  };
};

type FeedUpdateInput = {
  readonly where: {
    readonly id: bigint;
  };
  readonly data: {
    readonly subscriberCount?: { readonly increment: number };
    readonly errorCount?: number;
    readonly etag?: string | null;
    readonly lastModified?: string | null;
  };
};

class FakeRedisCommand {
  public readonly store = new Map<string, { readonly value: string; readonly expiresAtMs: number | null }>();

  public call(command: string, ...args: readonly unknown[]): Promise<string | number | null> {
    const normalized = command.toUpperCase();
    const key = redisStringValue(args[0]);
    this.expireIfNeeded(key);

    switch (normalized) {
      case "SET": {
        const value = redisStringValue(args[1]);
        const exIndex = args.findIndex((arg) => redisStringValue(arg).toUpperCase() === "EX");
        const ttlSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : null;
        this.store.set(key, {
          value,
          expiresAtMs: ttlSeconds === null || !Number.isFinite(ttlSeconds) ? null : Date.now() + ttlSeconds * 1000
        });
        return Promise.resolve("OK");
      }
      case "GET":
        return Promise.resolve(this.store.get(key)?.value ?? null);
      case "DEL":
        this.store.delete(key);
        return Promise.resolve(1);
      case "TTL": {
        const entry = this.store.get(key);
        if (entry === undefined) return Promise.resolve(-2);
        if (entry.expiresAtMs === null) return Promise.resolve(-1);
        return Promise.resolve(Math.max(0, Math.ceil((entry.expiresAtMs - Date.now()) / 1000)));
      }
      default:
        return Promise.reject(new Error(`unsupported redis command ${command}`));
    }
  }

  private expireIfNeeded(key: string): void {
    const entry = this.store.get(key);
    if (entry?.expiresAtMs !== null && entry?.expiresAtMs !== undefined && entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
    }
  }
}

describe("Admin feed onboarding API", () => {
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
      method: "POST",
      url: "/admin-api/operations/feed-onboarding-requests",
      headers: { "content-type": "application/json" },
      payload: { feedUrl: "https://news.example.org/feed.xml", label: "Example News" }
    });

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.payload)).toMatchObject({
      configured: false,
      authenticated: false,
      reason: "not_configured"
    });
    expectNoWrites(database);
  });

  it("requires an authenticated admin session before validation or writes", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const response = await postOnboarding({ cookie: "", csrfToken: csrfToken(), idempotencyKey: idempotencyKey() });

    expect(response.statusCode).toBe(401);
    expect(response.payload).not.toContain("feed_");
    expect(database.$transaction).not.toHaveBeenCalled();
    expectNoWrites(database);
  });

  it("rejects malformed bodies, missing CSRF, invalid CSRF, missing idempotency, and query strings", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");

    const malformed = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey(),
      payload: { feedUrl: "https://news.example.org/feed.xml", rawFeedUrl: "https://news.example.org/feed.xml" }
    });
    expect(malformed.statusCode).toBe(422);

    const missingCsrf = await postOnboarding({
      cookie: session.cookie,
      csrfToken: undefined,
      idempotencyKey: idempotencyKey()
    });
    expect(missingCsrf.statusCode).toBe(403);

    const invalidCsrf = await postOnboarding({
      cookie: session.cookie,
      csrfToken: csrfToken(),
      idempotencyKey: idempotencyKey()
    });
    expect(invalidCsrf.statusCode).toBe(403);

    const missingIdempotency = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: undefined
    });
    expect(missingIdempotency.statusCode).toBe(400);

    const nonEmptyQuery = await fastify.inject({
      method: "POST",
      url: "/admin-api/operations/feed-onboarding-requests?token=example",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-admin-csrf": session.csrfToken,
        "x-admin-idempotency-key": idempotencyKey()
      },
      payload: { feedUrl: "https://news.example.org/feed.xml", label: "Example News" }
    });
    expect(nonEmptyQuery.statusCode).toBe(400);
    expectNoWrites(database);
  });

  it("rejects unsafe feed URL targets without touching feed state", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");
    const unsafeUrls = [
      "http://news.example.org/feed.xml",
      "https://user:pass@news.example.org/feed.xml",
      "https://news.example.org/feed.xml#frag",
      "https://localhost/feed.xml",
      "https://host.docker.internal/feed.xml",
      "https://127.0.0.1/feed.xml",
      "https://169.254.10.10/feed.xml",
      "https://172.16.0.1/feed.xml",
      "https://192.168.1.20/feed.xml",
      "https://main-service-api/feed.xml"
    ];

    for (const feedUrl of unsafeUrls) {
      const response = await postOnboarding({
        cookie: session.cookie,
        csrfToken: session.csrfToken,
        idempotencyKey: idempotencyKey(),
        payload: { feedUrl }
      });
      expect(response.statusCode).toBe(422);
    }

    expectNoWrites(database);
  });

  it("creates one reserved admin onboarding relation and makes the feed eligible without exposing the raw URL", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");

    const response = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "created",
      feed: {
        displayId: "feed_f595e17cbb",
        sourceHost: "news.example.org",
        state: "active",
        eligibleForRecheck: true
      }
    });
    expect(String(body.requestRef)).toMatch(/^onboard_[A-Za-z0-9_-]{12,64}$/u);
    expect(response.payload).not.toContain("https://news.example.org/feed.xml");
    expect(response.payload).not.toContain("private=1");
    expect(response.payload).not.toContain("test-only-admin-password");
    const createInput = firstMockArg<FeedCreateInput>(database.feed.create);
    expect(createInput.data).toMatchObject({
      url: "https://news.example.org/feed.xml?private=1",
      title: "Example News",
      active: true,
      subscriberCount: 0
    });
    expect(database.siteFeed.create).toHaveBeenCalledWith({
      data: {
        siteClientId: ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID,
        feedId: 202n,
        createdAt: expect.any(Date) as Date
      }
    });
    const updateInput = firstMockArg<FeedUpdateInput>(database.feed.update);
    expect(updateInput.where).toEqual({ id: 202n });
    expect(updateInput.data).toMatchObject({
      subscriberCount: { increment: 1 },
      errorCount: 0,
      etag: null,
      lastModified: null
    });
  });

  it("dedupes idempotent retries and rate limits a second accepted request for the same host", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");
    const key = idempotencyKey();

    const first = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: key
    });
    expect(first.statusCode).toBe(201);
    const firstBody = JSON.parse(first.payload) as { readonly requestRef: string };

    const replay = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: key
    });
    expect(replay.statusCode).toBe(200);
    expect(JSON.parse(replay.payload)).toMatchObject({
      status: "created",
      requestRef: firstBody.requestRef
    });
    expect(database.siteFeed.create).toHaveBeenCalledTimes(1);

    const second = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });
    expect(second.statusCode).toBe(429);
    expect(JSON.parse(second.payload)).toMatchObject({
      status: "rate_limited",
      feed: null
    });
    expect(database.siteFeed.create).toHaveBeenCalledTimes(1);
  });

  it("returns already_exists for an existing admin-onboarded feed without broad writes", async () => {
    database = fakeDatabase({
      feed: {
        id: 303n,
        url: "https://news.example.org/feed.xml?private=1",
        title: "Example News",
        active: true,
        subscriberCount: 2,
        nextCheckAt: new Date("2099-07-01T05:00:00.000Z")
      },
      adminRelationExists: true
    });
    await boot(singleAdminConfig("test-only-admin-password"), database);
    const session = await login("test-only-admin-password");

    const response = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      status: "already_exists",
      feed: {
        displayId: "feed_12e0f54849",
        sourceHost: "news.example.org",
        state: "active",
        eligibleForRecheck: true
      }
    });
    expect(database.feed.create).not.toHaveBeenCalled();
    expect(database.feed.update).not.toHaveBeenCalled();
    expect(database.siteFeed.create).not.toHaveBeenCalled();
  });

  it("does not activate an existing disabled feed", async () => {
    database = fakeDatabase({
      feed: {
        id: 404n,
        url: "https://news.example.org/feed.xml?private=1",
        title: "Example News",
        active: false,
        subscriberCount: 0,
        nextCheckAt: null
      }
    });
    await boot(singleAdminConfig("test-only-admin-password"), database);
    const session = await login("test-only-admin-password");

    const response = await postOnboarding({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload)).toMatchObject({
      status: "unavailable",
      feed: {
        displayId: "feed_6db0882476",
        sourceHost: "news.example.org",
        state: "disabled",
        eligibleForRecheck: false
      }
    });
    expect(database.siteFeed.create).not.toHaveBeenCalled();
    expect(database.feed.update).not.toHaveBeenCalled();
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

  async function login(password: string): Promise<{ readonly cookie: string; readonly csrfToken: string }> {
    const response = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password }
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { readonly csrfToken: string };
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{32,128}$/u);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      csrfToken: body.csrfToken
    };
  }

  async function postOnboarding({
    cookie,
    csrfToken: csrf,
    idempotencyKey: idempotency,
    payload = { feedUrl: "https://news.example.org/feed.xml?private=1", label: "Example News" }
  }: {
    readonly cookie: string;
    readonly csrfToken: string | undefined;
    readonly idempotencyKey: string | undefined;
    readonly payload?: Record<string, unknown>;
  }): Promise<LightMyRequestResponse> {
    return fastify.inject({
      method: "POST",
      url: "/admin-api/operations/feed-onboarding-requests",
      headers: {
        cookie,
        "content-type": "application/json",
        ...(csrf === undefined ? {} : { "x-admin-csrf": csrf }),
        ...(idempotency === undefined ? {} : { "x-admin-idempotency-key": idempotency })
      },
      payload
    });
  }
});

function fakeDatabase(options: { readonly feed?: FeedRow | null; readonly adminRelationExists?: boolean } = {}) {
  const state = {
    feed:
      options.feed === undefined
        ? null
        : options.feed,
    adminRelationExists: options.adminRelationExists ?? false
  };

  const database: {
    $transaction: jest.Mock;
    feed: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    siteFeed: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
  } = {
    $transaction: jest.fn((callback: (transaction: typeof database) => Promise<unknown>) => callback(database)),
    feed: {
      findUnique: jest.fn(() => Promise.resolve(state.feed)),
      findUniqueOrThrow: jest.fn(() => {
        if (state.feed === null) return Promise.reject(new Error("feed_not_found"));
        return Promise.resolve(state.feed);
      }),
      create: jest.fn((input: FeedCreateInput) => {
        state.feed = {
          id: 202n,
          url: input.data.url,
          title: input.data.title,
          active: input.data.active,
          subscriberCount: input.data.subscriberCount,
          nextCheckAt: input.data.nextCheckAt
        };
        return Promise.resolve(state.feed);
      }),
      update: jest.fn(() => {
        if (state.feed === null) return Promise.reject(new Error("feed_not_found"));
        state.feed = {
          ...state.feed,
          subscriberCount: state.feed.subscriberCount + 1,
          nextCheckAt: state.feed.subscriberCount <= 0 ? new Date("2026-07-01T00:00:00.000Z") : state.feed.nextCheckAt
        };
        return Promise.resolve(state.feed);
      }),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn()
    },
    siteFeed: {
      findUnique: jest.fn(() => Promise.resolve(state.adminRelationExists ? { feedId: state.feed?.id ?? 202n } : null)),
      create: jest.fn(() => {
        state.adminRelationExists = true;
        return Promise.resolve({ feedId: state.feed?.id ?? 202n });
      }),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn()
    }
  };

  return database;
}

function firstMockArg<T>(mock: jest.Mock): T {
  const call = mock.mock.calls[0] as readonly unknown[] | undefined;
  if (call === undefined || call[0] === undefined) throw new Error("expected mock to have been called");
  return call[0] as T;
}

function expectNoWrites(database: ReturnType<typeof fakeDatabase>): void {
  expect(database.feed.create).not.toHaveBeenCalled();
  expect(database.feed.update).not.toHaveBeenCalled();
  expect(database.feed.updateMany).not.toHaveBeenCalled();
  expect(database.feed.delete).not.toHaveBeenCalled();
  expect(database.feed.deleteMany).not.toHaveBeenCalled();
  expect(database.feed.upsert).not.toHaveBeenCalled();
  expect(database.siteFeed.create).not.toHaveBeenCalled();
  expect(database.siteFeed.update).not.toHaveBeenCalled();
  expect(database.siteFeed.updateMany).not.toHaveBeenCalled();
  expect(database.siteFeed.delete).not.toHaveBeenCalled();
  expect(database.siteFeed.deleteMany).not.toHaveBeenCalled();
  expect(database.siteFeed.upsert).not.toHaveBeenCalled();
}

function redisStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return "";
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

function csrfToken(): string {
  return "invalid_csrf_token_value_at_least_32_chars";
}

function idempotencyKey(): string {
  return `idem_${Math.random().toString(36).slice(2, 20)}_${Date.now().toString(36)}`;
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
