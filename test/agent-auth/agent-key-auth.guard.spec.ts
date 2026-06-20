import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentAuthModule } from "../../src/agent-auth/agent-auth.module";
import { AGENT_PRINCIPAL_REQUEST_KEY } from "../../src/agent-auth/agent-auth.constants";
import { AgentAuthenticatedRequest } from "../../src/agent-auth/agent-auth.types";
import { AgentKeyAuthGuard } from "../../src/agent-auth/agent-key-auth.guard";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

const agentKey = "test_only_agent_key_at_least_32_bytes";

@Controller("agent/probe")
class AgentProbeController {
  @Get()
  @UseGuards(AgentKeyAuthGuard)
  public show(@Req() request: AgentAuthenticatedRequest): { readonly agent_id: string | undefined } {
    return {
      agent_id: request[AGENT_PRINCIPAL_REQUEST_KEY]?.agentId
    };
  }
}

describe("AgentKeyAuthGuard", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register({ ...runtimeConfig, agentAuth: { key: agentKey } }), AgentAuthModule],
      controllers: [AgentProbeController]
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

  it("attaches the default agent principal for the exact key", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/agent/probe",
      headers: {
        "X-Agent-Key": agentKey
      }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ agent_id: "default" });
  });

  it("returns a uniform safe 401 for missing, malformed, duplicate, or wrong credentials", async () => {
    const requests = [
      {},
      { headers: { "X-Agent-Key": " " } },
      { headers: { "X-Agent-Key": "wrong_agent_key_at_least_32_bytes" } },
      { headers: { "X-Agent-Key": [agentKey, agentKey] } }
    ];

    for (const request of requests) {
      const response = await fastify.inject({
        method: "GET",
        url: "/agent/probe",
        ...request
      });
      const body = JSON.parse(response.payload) as Record<string, unknown>;

      expect(response.statusCode).toBe(401);
      expect(body).not.toHaveProperty("error_code");
      expect(response.payload).not.toContain(agentKey);
    }
  });

  it("does not accept tenant Authorization as an agent credential", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/agent/probe",
      headers: {
        authorization: "Bearer tenant-token"
      }
    });

    expect(response.statusCode).toBe(401);
  });
});
