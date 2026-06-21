export class AgentFeedCheckResultsFeedNotFoundError extends Error {
  public constructor() {
    super("agent_feed_check_results_feed_not_found");
  }
}

export class AgentFeedCheckResultsCheckIdPayloadMismatchError extends Error {
  public constructor() {
    super("agent_feed_check_results_check_id_payload_mismatch");
  }
}

export class AgentFeedCheckResultsCheckedAtTooOldError extends Error {
  public constructor() {
    super("agent_feed_check_results_checked_at_too_old");
  }
}

export class AgentFeedCheckResultsCheckedAtInFutureError extends Error {
  public constructor() {
    super("agent_feed_check_results_checked_at_in_future");
  }
}
