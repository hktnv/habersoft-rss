import type { AgentEntriesRequest, AgentEntriesResponse, AgentEntriesWriteResult } from "./agent-entries.types";

export function toAgentEntriesResponse(
  request: AgentEntriesRequest,
  result: AgentEntriesWriteResult
): AgentEntriesResponse {
  return {
    ok: true,
    check_id: request.checkId,
    feed_id: request.feedId.toString(10),
    entries_submitted_count: request.entries.length,
    entries_saved_count: result.entriesSavedCount,
    replay: result.replay
  };
}
