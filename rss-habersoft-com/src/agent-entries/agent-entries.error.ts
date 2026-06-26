export class AgentEntriesFeedNotFoundError extends Error {
  public constructor() {
    super("agent_entries_feed_not_found");
  }
}

export class AgentEntriesCheckIdPayloadMismatchError extends Error {
  public constructor() {
    super("agent_entries_check_id_payload_mismatch");
  }
}

export class AgentEntriesCheckedAtTooOldError extends Error {
  public constructor() {
    super("agent_entries_checked_at_too_old");
  }
}

export class AgentEntriesCheckedAtInFutureError extends Error {
  public constructor() {
    super("agent_entries_checked_at_in_future");
  }
}
