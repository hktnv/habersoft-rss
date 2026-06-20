import type { AgentEntriesResponse, AgentEntriesWriteResult } from "./agent-entries.types";

export function toAgentEntriesResponse(result: AgentEntriesWriteResult): AgentEntriesResponse {
  return {
    saved: result.entriesSavedCount,
    idempotent_replay: result.replay
  };
}
