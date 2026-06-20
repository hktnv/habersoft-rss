import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AgentHeartbeatController } from "../../src/agent-heartbeat/agent-heartbeat.controller";
import { RecordAgentHeartbeatUseCase } from "../../src/agent-heartbeat/record-agent-heartbeat.use-case";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const validPayload = {
  status: "ok",
  sent_at: "2026-06-17T02:05:00Z",
  feeds_processed: 500,
  errors_count: 2,
  stale_check_results_dropped: 0,
  stale_entries_dropped: 0
};

describe("AgentHeartbeatController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let execute: jest.Mock<Promise<void>, Parameters<RecordAgentHeartbeatUseCase["execute"]>>;

  beforeEach(async () => {
    execute = jest.fn<Promise<void>, Parameters<RecordAgentHeartbeatUseCase["execute"]>>().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register(runtimeConfig), AgentAuthModule],
      controllers: [AgentHeartbeatController],
      providers: [
        {
          provide: RecordAgentHeartbeatUseCase,
          useValue: { execute }
        }
      ]
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

  it("returns exact 200 { ok: true } for an authenticated valid heartbeat", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: { "X-Agent-Key": agentKey },
      payload: validPayload
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      { agentId: "default" },
      {
        status: "ok",
        sentAt: new Date("2026-06-17T02:05:00Z"),
        feedsProcessed: 500,
        errorsCount: 2,
        staleCheckResultsDropped: 0,
        staleEntriesDropped: 0
      }
    );
  });

  it("runs auth before validation and returns 401 for missing or tenant credentials", async () => {
    const unauthenticated = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      payload: { agent_id: "default" }
    });
    const tenantToken = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: { authorization: "Bearer tenant-token" },
      payload: validPayload
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(tenantToken.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 422 with the shared validation envelope for authenticated invalid payloads or query params", async () => {
    const invalidBody = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: { "X-Agent-Key": agentKey },
      payload: { ...validPayload, agent_id: "default" }
    });
    const invalidQuery = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat?agent_id=default",
      headers: { "X-Agent-Key": agentKey },
      payload: validPayload
    });

    expect(invalidBody.statusCode).toBe(422);
    expect(invalidQuery.statusCode).toBe(422);
    expect(JSON.parse(invalidBody.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps malformed JSON as a framework 400 before validation", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: {
        "X-Agent-Key": agentKey,
        "content-type": "application/json"
      },
      payload: "{"
    });

    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
