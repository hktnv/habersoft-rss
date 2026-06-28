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

describe("Admin auth API boundary", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let redis: FakeRedisCommand;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("defaults admin auth to disabled without requiring a credential", async () => {
    await boot({ ...runtimeConfig, adminAuth: { mode: "disabled" } });

    const response = await fastify.inject({
      method: "GET",
      url: "/admin-auth/session"
    });

    expect(response.statusCode).toBe(501);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(response.payload)).toEqual({
      configured: false,
      authenticated: false,
      status: "not_configured",
      reason: "not_configured",
      message: "Admin authentication is not configured."
    });
  });

  it("keeps unauthenticated, invalid login, authenticated session, and logout flows server-side", async () => {
    const password = "test-only-admin-password";
    await boot(singleAdminConfig(password));

    const firstSession = await fastify.inject({
      method: "GET",
      url: "/admin-auth/session"
    });
    expect(firstSession.statusCode).toBe(200);
    expect(JSON.parse(firstSession.payload)).toEqual({
      configured: true,
      authenticated: false,
      reason: "unauthenticated"
    });

    const invalid = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "wrong" }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.headers["set-cookie"]).toBeUndefined();

    const valid = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password }
    });
    expect(valid.statusCode).toBe(200);
    const loginBody = parseJson(valid.payload);
    expect(loginBody).toMatchObject({
      configured: true,
      authenticated: true,
      principal: { kind: "single_admin", displayName: "Admin" }
    });
    expect(JSON.stringify(loginBody)).not.toContain(password);

    const setCookie = valid.headers["set-cookie"];
    expect(setCookie).toEqual(expect.stringContaining("HttpOnly"));
    expect(setCookie).toEqual(expect.stringContaining("SameSite=Lax"));
    expect(setCookie).toEqual(expect.stringContaining("Path=/admin-auth"));
    expect(redis.store.size).toBe(1);

    const authenticated = await fastify.inject({
      method: "GET",
      url: "/admin-auth/session",
      headers: {
        cookie: Array.isArray(setCookie) ? setCookie[0] : setCookie
      }
    });
    expect(authenticated.statusCode).toBe(200);
    expect(JSON.parse(authenticated.payload)).toMatchObject({
      configured: true,
      authenticated: true,
      principal: { kind: "single_admin", displayName: "Admin" }
    });

    const logout = await fastify.inject({
      method: "POST",
      url: "/admin-auth/logout",
      headers: {
        cookie: Array.isArray(setCookie) ? setCookie[0] : setCookie
      }
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toEqual(expect.stringContaining("Max-Age=0"));
    expect(redis.store.size).toBe(0);
  });

  it("rate limits repeated invalid login attempts", async () => {
    await boot(singleAdminConfig("test-only-admin-password"));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fastify.inject({
        method: "POST",
        url: "/admin-auth/login",
        payload: { username: "admin", password: "wrong" }
      });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await fastify.inject({
      method: "POST",
      url: "/admin-auth/login",
      payload: { username: "admin", password: "wrong" }
    });
    expect(blocked.statusCode).toBe(429);
    expect(JSON.parse(blocked.payload)).toMatchObject({
      error_code: "ADMIN_AUTH_RATE_LIMITED",
      authenticated: false
    });
  });

  async function boot(config: RuntimeConfig): Promise<void> {
    redis = new FakeRedisCommand();
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
        database: jest.fn().mockReturnValue({})
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  }
});

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

function parseJson(payload: string): unknown {
  return JSON.parse(payload) as unknown;
}
