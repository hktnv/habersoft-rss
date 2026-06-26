import type { AgentFeedCheckResultsResponse, AgentFeedCheckResultsWriteResult } from "./agent-feed-check-results.types";

export function toAgentFeedCheckResultsResponse(
  result: AgentFeedCheckResultsWriteResult
): AgentFeedCheckResultsResponse {
  return {
    accepted: result.accepted,
    feed_state_updated: result.feedStateUpdated,
    idempotent_replay_count: result.idempotentReplayCount,
    out_of_order_result_count: result.outOfOrderResultCount
  };
}
