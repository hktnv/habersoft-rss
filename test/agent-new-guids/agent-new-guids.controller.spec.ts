import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AgentNewGuidsController } from "../../src/agent-new-guids/agent-new-guids.controller";
import { AgentNewGuidsFeedNotFoundError } from "../../src/agent-new-guids/agent-new-guids.error";
import { FilterAgentNewGuidsUseCase } from "../../src/agent-new-guids/filter-agent-new-guids.use-case";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";

describe("AgentNewGuidsController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let execute: jest.Mock<Promise<Awaited<ReturnType<FilterAgentNewGuidsUseCase["execute"]>>>, Parameters<FilterAgentNewGuidsUseCase["execute"]>>;

  beforeEach(async () => {
    execute = jest
      .fn<ReturnType<FilterAgentNewGuidsUseCase["execute"]>, Parameters<FilterAgentNewGuidsUseCase["execute"]>>()
      .mockResolvedValue({ new: ["new-a", "new-b"] });

    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register(runtimeConfig), AgentAuthModule],
      controllers: [AgentNewGuidsController],
      providers: [{ provide: FilterAgentNewGuidsUseCase, useValue: { execute } }]
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

  it("returns the exact new-GUID response for an authenticated valid request", async () => {
    const response = await postNewGuids("35", { guids: ["new-a", "existing", "new-b"] });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ new: ["new-a", "new-b"] });
    expect(execute).toHaveBeenCalledWith({
      feedId: 35n,
      guids: ["new-a", "existing", "new-b"]
    });
  });

  it("runs auth before path and body validation and keeps tenant credentials out", async () => {
    const missingKey = await fastify.inject({
      method: "POST",
      url: "/agent/feeds/not-a-number/new-guids",
      payload: { status: 200 }
    });
    const tenantToken = await fastify.inject({
      method: "POST",
      url: "/agent/feeds/35/new-guids",
      headers: { authorization: "Bearer tenant-token" },
      payload: { guids: ["abc"] }
    });

    expect(missingKey.statusCode).toBe(401);
    expect(tenantToken.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 422 with the shared validation envelope for authenticated invalid input", async () => {
    for (const [feedId, body, urlSuffix] of [
      ["0", { guids: ["abc"] }, ""],
      ["35", { guids: [] }, ""],
      ["35", { guids: [" abc"] }, ""],
      ["35", { guids: ["abc"], status: 200 }, ""],
      ["35", { guids: ["abc"] }, "?limit=1"]
    ] as const) {
      const response = await fastify.inject({
        method: "POST",
        url: `/agent/feeds/${feedId}/new-guids${urlSuffix}`,
        headers: { "X-Agent-Key": agentKey },
        payload: body
      });

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps unknown feed to 422 instead of all-new success", async () => {
    execute.mockRejectedValueOnce(new AgentNewGuidsFeedNotFoundError());

    const response = await postNewGuids("404", { guids: ["new"] });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
  });

  async function postNewGuids(feedId: string, payload: { readonly guids: readonly string[] }) {
    return fastify.inject({
      method: "POST",
      url: `/agent/feeds/${feedId}/new-guids`,
      headers: { "X-Agent-Key": agentKey },
      payload
    });
  }
});
