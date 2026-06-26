import type { AgentPrincipal } from "./agent-auth.types";

export function createAgentPrincipal(): AgentPrincipal {
  return Object.freeze({
    agentId: "default" as const
  });
}
