import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AgentEntriesController } from "../../src/agent-entries/agent-entries.controller";
import {
  AgentEntriesCheckedAtTooOldError,
  AgentEntriesCheckIdPayloadMismatchError,
  AgentEntriesFeedNotFoundError
} from "../../src/agent-entries/agent-entries.error";
import { RecordAgentEntriesUseCase } from "../../src/agent-entries/record-agent-entries.use-case";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";

describe("AgentEntriesController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let execute: jest.Mock<Promise<Awaited<ReturnType<RecordAgentEntriesUseCase["execute"]>>>, Parameters<RecordAgentEntriesUseCase["execute"]>>;

  beforeEach(async () => {
    execute = jest.fn<ReturnType<RecordAgentEntriesUseCase["execute"]>, Parameters<RecordAgentEntriesUseCase["execute"]>>()
      .mockResolvedValue({
        saved: 1,
        idempotent_replay: false
      });

    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register(runtimeConfig), AgentAuthModule],
      controllers: [AgentEntriesController],
      providers: [{ provide: RecordAgentEntriesUseCase, useValue: { execute } }]
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

  it("returns the exact success envelope for an authenticated valid request", async () => {
    const response = await postEntries(validPayload());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      saved: 1,
      idempotent_replay: false
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ feedId: 35n }));
  });

  it("runs auth before payload validation", async () => {
    const missingKey = await fastify.inject({
      method: "POST",
      url: "/agent/entries",
      payload: { unknown: true }
    });

    expect(missingKey.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 422 with a stable validation envelope", async () => {
    const response = await postEntries({ ...validPayload(), entries: [] });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps domain validation failures to the expected error codes", async () => {
    for (const [error, code] of [
      [new AgentEntriesCheckedAtTooOldError(), "CHECKED_AT_TOO_OLD"],
      [new AgentEntriesCheckIdPayloadMismatchError(), "CHECK_ID_PAYLOAD_MISMATCH"],
      [new AgentEntriesFeedNotFoundError(), "VALIDATION_FAILED"]
    ] as const) {
      execute.mockRejectedValueOnce(error);
      const response = await postEntries(validPayload());

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.payload)).toMatchObject({ error_code: code });
    }
  });

  async function postEntries(payload: Record<string, unknown>) {
    return fastify.inject({
      method: "POST",
      url: "/agent/entries",
      headers: { "X-Agent-Key": agentKey },
      payload
    });
  }
});

function validPayload(): Record<string, unknown> {
  return {
    check_id: "01K8Z3ABCD0000000000000001",
    feed_id: "35",
    checked_at: "2026-06-20T10:00:00Z",
    tier_attempted: 1,
    feed_title: "Feed title",
    response_etag: '"etag"',
    response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
    entries: [
      {
        guid: "entry-guid",
        url: "https://example.test/entry-guid",
        title: "Entry title",
        summary: null,
        images: [],
        videos: [],
        tags: [],
        author: null,
        meta: null,
        published_at: null,
        detail: "Article body",
        detail_extraction: {
          status: "ok",
          attempted_at: "2026-06-20T10:00:01Z",
          finalized_at: "2026-06-20T10:00:02Z",
          error_code: null
        }
      }
    ]
  };
}
