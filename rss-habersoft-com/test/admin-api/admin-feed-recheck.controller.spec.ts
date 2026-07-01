import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { ApiModule } from "../../src/api.module";
import { createFeedRecheckActionRef } from "../../src/admin-api/admin-feed-recheck-action-ref";
import { hashAdminPassword } from "../../src/admin-auth/admin-password-hash";
import type { RuntimeConfig } from "../../src/configuration/runtime-config";
import { PostgresService } from "../../src/persistence/postgres.service";
import { RedisService } from "../../src/redis/redis.service";
import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type FeedUpdateManyInput = {
  readonly where: {
    readonly id: bigint;
    readonly active: true;
    readonly subscriberCount: {
      readonly gt: 0;
    };
  };
  readonly data: {
    readonly nextCheckAt: Date;
  };
};

type FeedUpdateMany = (input: FeedUpdateManyInput) => Promise<{ readonly count: number }>;

class FakeRedisCommand {
  public readonly store = new Map<string, { readonly value: string; readonly expiresAtMs: number | null }>();

  public call(command: string, ...args: readonly unknown[]): Promise<string | number | null> {
    const normalized = command.toUpperCase();
    const key = redisStringValue(args[0]);
    this.expireIfNeeded(key);

    switch (normalized) {
      case "SET": {
        const value = redisStringValue(args[1]);
        const nx = args.some((arg) => redisStringValue(arg).toUpperCase() === "NX");
        if (nx && this.store.has(key)) return Promise.resolve(null);
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

describe("Admin feed recheck API", () => {
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
      url: "/admin-api/operations/feed-recheck-requests",
      headers: { "content-type": "application/json" },
      payload: { actionRef: actionRef(101n), reason: "operator_request" }
    });

    expect(response.statusCode).toBe(501);
    expect(JSON.parse(response.payload)).toMatchObject({
      configured: false,
      authenticated: false,
      reason: "not_configured"
    });
    expect(database.feed.updateMany).not.toHaveBeenCalled();
  });

  it("requires an authenticated admin session before validation or scheduling", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    const response = await postRecheck({ cookie: "", csrfToken: csrfToken(), idempotencyKey: idempotencyKey() });

    expect(response.statusCode).toBe(401);
    expect(response.payload).not.toContain("feed_");
    expect(database.feed.findUnique).not.toHaveBeenCalled();
    expect(database.feed.updateMany).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies, missing CSRF, invalid CSRF, and missing idempotency", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");

    const malformed = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey(),
      payload: { actionRef: actionRef(101n), rawFeedUrl: "https://news.example.org/feed.xml" }
    });
    expect(malformed.statusCode).toBe(422);

    const missingCsrf = await postRecheck({
      cookie: session.cookie,
      csrfToken: undefined,
      idempotencyKey: idempotencyKey()
    });
    expect(missingCsrf.statusCode).toBe(403);

    const invalidCsrf = await postRecheck({
      cookie: session.cookie,
      csrfToken: csrfToken(),
      idempotencyKey: idempotencyKey()
    });
    expect(invalidCsrf.statusCode).toBe(403);

    const missingIdempotency = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: undefined
    });
    expect(missingIdempotency.statusCode).toBe(400);

    const nonEmptyQuery = await fastify.inject({
      method: "POST",
      url: "/admin-api/operations/feed-recheck-requests?token=example",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-admin-csrf": session.csrfToken,
        "x-admin-idempotency-key": idempotencyKey()
      },
      payload: { actionRef: actionRef(101n), reason: "operator_request" }
    });
    expect(nonEmptyQuery.statusCode).toBe(400);
    expect(database.feed.updateMany).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown opaque target", async () => {
    database = fakeDatabase({ feed: null });
    await boot(singleAdminConfig("test-only-admin-password"), database);
    const session = await login("test-only-admin-password");

    const response = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey(),
      payload: { actionRef: actionRef(999n), reason: "operator_request" }
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.payload)).toMatchObject({
      status: "not_found",
      target: null,
      queued: false
    });
    expect(database.feed.updateMany).not.toHaveBeenCalled();
  });

  it("schedules one eligible feed by moving nextCheckAt to now and dedupes retries", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");
    const key = idempotencyKey();

    const accepted = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: key
    });
    expect(accepted.statusCode).toBe(202);
    const acceptedBody = JSON.parse(accepted.payload) as Record<string, unknown>;
    expect(acceptedBody).toMatchObject({
      status: "accepted",
      queued: true,
      cooldownSeconds: 300,
      target: {
        displayId: "feed_61fe59eacb",
        sourceHost: "news.example.org"
      }
    });
    expect(String(acceptedBody.requestId)).toMatch(/^recheck_[A-Za-z0-9_-]{12,64}$/u);
    expect(accepted.payload).not.toContain("https://news.example.org/feed.xml");
    expect(database.feed.updateMany).toHaveBeenCalledTimes(1);
    const updateMany = database.feed.updateMany as jest.MockedFunction<FeedUpdateMany>;
    const updateInput = updateMany.mock.calls[0]?.[0];
    expect(updateInput?.where).toEqual({ id: 101n, active: true, subscriberCount: { gt: 0 } });
    expect(updateInput?.data?.nextCheckAt).toBeInstanceOf(Date);

    const duplicate = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: key
    });
    expect(duplicate.statusCode).toBe(200);
    expect(JSON.parse(duplicate.payload)).toMatchObject({
      status: "already_pending",
      queued: false,
      target: {
        displayId: "feed_61fe59eacb",
        sourceHost: "news.example.org"
      }
    });
    expect(database.feed.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rate limits a second accepted request for the same target during cooldown", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));
    const session = await login("test-only-admin-password");

    const first = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });
    expect(first.statusCode).toBe(202);

    const second = await postRecheck({
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      idempotencyKey: idempotencyKey()
    });
    expect(second.statusCode).toBe(429);
    const secondBody = JSON.parse(second.payload) as { readonly status?: unknown; readonly queued?: unknown; readonly cooldownSeconds?: unknown };
    expect(secondBody).toMatchObject({
      status: "rate_limited",
      queued: false
    });
    expect(typeof secondBody.cooldownSeconds).toBe("number");
    expect(database.feed.updateMany).toHaveBeenCalledTimes(1);
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

  async function postRecheck({
    cookie,
    csrfToken: csrf,
    idempotencyKey: idempotency,
    payload = { actionRef: actionRef(101n), reason: "operator_request" }
  }: {
    readonly cookie: string;
    readonly csrfToken: string | undefined;
    readonly idempotencyKey: string | undefined;
    readonly payload?: Record<string, unknown>;
  }): Promise<LightMyRequestResponse> {
    return fastify.inject({
      method: "POST",
      url: "/admin-api/operations/feed-recheck-requests",
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

function fakeDatabase(options: { readonly feed?: ReturnType<typeof feedProjection> | null } = {}) {
  return {
    feed: {
      findUnique: jest.fn().mockResolvedValue(options.feed === undefined ? feedProjection() : options.feed),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    }
  };
}

function redisStringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return "";
}

function feedProjection() {
  return {
    id: 101n,
    url: "https://news.example.org/feed.xml?private=1",
    active: true,
    subscriberCount: 2,
    nextCheckAt: new Date("2099-07-01T05:00:00.000Z")
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

function actionRef(feedId: bigint): string {
  return createFeedRecheckActionRef(feedId, "test_only_admin_session_secret_at_least_32_bytes");
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
