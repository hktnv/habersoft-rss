import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AgentDueFeedsController } from "../../src/agent-due-feeds/agent-due-feeds.controller";
import { ListAgentDueFeedsUseCase } from "../../src/agent-due-feeds/list-agent-due-feeds.use-case";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";

describe("AgentDueFeedsController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let execute: jest.Mock<Promise<Awaited<ReturnType<ListAgentDueFeedsUseCase["execute"]>>>, Parameters<ListAgentDueFeedsUseCase["execute"]>>;

  beforeEach(async () => {
    execute = jest
      .fn<ReturnType<ListAgentDueFeedsUseCase["execute"]>, Parameters<ListAgentDueFeedsUseCase["execute"]>>()
      .mockResolvedValue({
      feeds: [
        {
          feed_id: "35",
          url: "https://www.ntv.com.tr/gundem.rss",
          etag: "\"abc123\"",
          last_modified: "Tue, 17 Jun 2026 01:00:00 GMT"
        }
      ],
      feed_poll_interval_seconds: 900,
      has_more_due: false
    });

    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register(runtimeConfig), AgentAuthModule],
      controllers: [AgentDueFeedsController],
      providers: [{ provide: ListAgentDueFeedsUseCase, useValue: { execute } }]
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns the exact due-feed object for an authenticated valid query", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/agent/feeds/due?limit=1",
      headers: { "X-Agent-Key": agentKey }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      feeds: [
        {
          feed_id: "35",
          url: "https://www.ntv.com.tr/gundem.rss",
          etag: "\"abc123\"",
          last_modified: "Tue, 17 Jun 2026 01:00:00 GMT"
        }
      ],
      feed_poll_interval_seconds: 900,
      has_more_due: false
    });
    expect(execute).toHaveBeenCalledWith({ limit: 1 });
  });

  it("runs auth before query validation and keeps tenant credentials out", async () => {
    const missingKey = await fastify.inject({ method: "GET", url: "/agent/feeds/due?limit=bad" });
    const tenantToken = await fastify.inject({
      method: "GET",
      url: "/agent/feeds/due?limit=1",
      headers: { authorization: "Bearer tenant-token" }
    });

    expect(missingKey.statusCode).toBe(401);
    expect(tenantToken.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 422 with the shared validation envelope for authenticated invalid queries", async () => {
    for (const url of ["/agent/feeds/due", "/agent/feeds/due?limit=501", "/agent/feeds/due?limit=1&offset=0"]) {
      const response = await fastify.inject({
        method: "GET",
        url,
        headers: { "X-Agent-Key": agentKey }
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
