import type { FastifyRequest } from "fastify";
import type { AGENT_PRINCIPAL_REQUEST_KEY } from "./agent-auth.constants";

export type AgentPrincipal = {
  readonly agentId: "default";
};

export type AgentAuthenticatedRequest = FastifyRequest & {
  [AGENT_PRINCIPAL_REQUEST_KEY]?: AgentPrincipal;
};

export type AgentKeyParseResult =
  | {
      readonly ok: true;
      readonly candidate: string;
    }
  | {
      readonly ok: false;
      readonly reason: "agent_key_header_missing" | "agent_key_header_multiple" | "agent_key_header_malformed";
    };
