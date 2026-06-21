import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AgentFeedCheckResultsController } from "../../src/agent-feed-check-results/agent-feed-check-results.controller";
import {
  AgentFeedCheckResultsCheckedAtTooOldError,
  AgentFeedCheckResultsCheckIdPayloadMismatchError,
  AgentFeedCheckResultsFeedNotFoundError
} from "../../src/agent-feed-check-results/agent-feed-check-results.error";
import { RecordAgentFeedCheckResultsUseCase } from "../../src/agent-feed-check-results/record-agent-feed-check-results.use-case";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";

describe("AgentFeedCheckResultsController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let execute: jest.Mock<
    ReturnType<RecordAgentFeedCheckResultsUseCase["execute"]>,
    Parameters<RecordAgentFeedCheckResultsUseCase["execute"]>
  >;

  beforeEach(async () => {
    execute = jest.fn<ReturnType<RecordAgentFeedCheckResultsUseCase["execute"]>, Parameters<RecordAgentFeedCheckResultsUseCase["execute"]>>()
      .mockResolvedValue({
        accepted: 3,
        feed_state_updated: 1,
        idempotent_replay_count: 1,
        out_of_order_result_count: 1
      });

    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register(runtimeConfig), AgentAuthModule],
      controllers: [AgentFeedCheckResultsController],
      providers: [{ provide: RecordAgentFeedCheckResultsUseCase, useValue: { execute } }]
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

  it("returns the exact four-counter response for an authenticated valid request", async () => {
    const response = await post(validPayload());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      accepted: 3,
      feed_state_updated: 1,
      idempotent_replay_count: 1,
      out_of_order_result_count: 1
    });
    expect(execute.mock.calls[0]?.[0].results[0]?.feedId).toBe(35n);
  });

  it("runs auth before payload validation", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/agent/feed-check-results",
      payload: { unknown: true }
    });

    expect(response.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid authenticated payloads", async () => {
    const response = await post({ results: [] });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "FEED_CHECK_RESULTS_EMPTY" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps domain validation failures to public error codes", async () => {
    for (const [error, code] of [
      [new AgentFeedCheckResultsCheckedAtTooOldError(), "CHECKED_AT_TOO_OLD"],
      [new AgentFeedCheckResultsCheckIdPayloadMismatchError(), "CHECK_ID_PAYLOAD_MISMATCH"],
      [new AgentFeedCheckResultsFeedNotFoundError(), "VALIDATION_FAILED"]
    ] as const) {
      execute.mockRejectedValueOnce(error);
      const response = await post(validPayload());

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.payload)).toMatchObject({ error_code: code });
    }
  });

  async function post(payload: Record<string, unknown>) {
    return fastify.inject({
      method: "POST",
      url: "/agent/feed-check-results",
      headers: { "X-Agent-Key": agentKey },
      payload
    });
  }
});

function validPayload(): Record<string, unknown> {
  return {
    results: [
      {
        check_id: "01K8Z3ABCD0000000000000001",
        feed_id: "35",
        http_status: 304,
        outcome: "not_modified",
        checked_at: "2026-06-20T10:00:00Z",
        tier_attempted: 1,
        error_code: null
      }
    ]
  };
}
