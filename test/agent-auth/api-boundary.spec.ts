import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { ApiModule } from "../../src/api.module";
import { PostgresService } from "../../src/persistence/postgres.service";
import { RedisService } from "../../src/redis/redis.service";
import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent auth API boundary", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule.register(runtimeConfig)]
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
      .overrideProvider(PostgresService)
      .useValue({ check: jest.fn().mockResolvedValue("up"), database: jest.fn().mockReturnValue({}) })
      .overrideProvider(RedisService)
      .useValue({ check: jest.fn().mockResolvedValue("up") })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("does not expose production agent routes in MS-008", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/agent/feeds/due",
      headers: {
        "X-Agent-Key": runtimeConfig.agentAuth?.key
      }
    });

    expect(response.statusCode).toBe(404);
  });

  it("keeps health endpoints unauthenticated", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/health/live"
    });

    expect(response.statusCode).toBe(200);
  });

  it("does not let an agent key open tenant routes", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: {
        "X-Agent-Key": runtimeConfig.agentAuth?.key
      }
    });

    expect(response.statusCode).toBe(401);
  });
});
