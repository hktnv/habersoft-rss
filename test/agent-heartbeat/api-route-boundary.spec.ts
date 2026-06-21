import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { ApiModule } from "../../src/api.module";
import { AgentDueFeedsReader } from "../../src/agent-due-feeds/agent-due-feeds.reader";
import { AgentHeartbeatRepository } from "../../src/agent-heartbeat/agent-heartbeat.repository";
import { AgentNewGuidsReader } from "../../src/agent-new-guids/agent-new-guids.reader";
import { PostgresService } from "../../src/persistence/postgres.service";
import { RedisService } from "../../src/redis/redis.service";
import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent heartbeat API route boundary", () => {
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
      .overrideProvider(AgentHeartbeatRepository)
      .useValue({ upsert: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(AgentDueFeedsReader)
      .useValue({ listDueFeeds: jest.fn().mockResolvedValue([]) })
      .overrideProvider(AgentNewGuidsReader)
      .useValue({ readExistingGuids: jest.fn().mockResolvedValue({ existingGuids: [] }) })
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

  it("exposes heartbeat, due-feed, new-GUID filtering, entries, and feed-check-results among production agent routes", async () => {
    const success = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key },
      payload: {
        status: "ok",
        sent_at: "2026-06-17T02:05:00Z",
        feeds_processed: 1,
        errors_count: 0,
        stale_check_results_dropped: 0,
        stale_entries_dropped: 0
      }
    });
    const due = await fastify.inject({
      method: "GET",
      url: "/agent/feeds/due?limit=1",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key }
    });
    const newGuids = await fastify.inject({
      method: "POST",
      url: "/agent/feeds/1/new-guids",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key },
      payload: { guids: ["guid-1"] }
    });
    const entries = await fastify.inject({
      method: "POST",
      url: "/agent/entries",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key },
      payload: {}
    });
    const results = await fastify.inject({
      method: "POST",
      url: "/agent/feed-check-results",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key },
      payload: { results: [] }
    });

    expect(success.statusCode).toBe(200);
    expect(due.statusCode).toBe(200);
    expect(newGuids.statusCode).toBe(200);
    expect(JSON.parse(newGuids.payload)).toEqual({ new: ["guid-1"] });
    expect(entries.statusCode).toBe(422);
    expect(JSON.parse(entries.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    expect(results.statusCode).toBe(422);
    expect(JSON.parse(results.payload)).toMatchObject({ error_code: "FEED_CHECK_RESULTS_EMPTY" });
  });

  it("keeps health endpoints unauthenticated and tenant routes closed to agent keys", async () => {
    const live = await fastify.inject({ method: "GET", url: "/health/live" });
    const tenantRoute = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { "X-Agent-Key": runtimeConfig.agentAuth?.key }
    });

    expect(live.statusCode).toBe(200);
    expect(tenantRoute.statusCode).toBe(401);
  });
});
