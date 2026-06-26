export type AgentFeedCheckOutcome = "not_modified" | "no_new_entries" | "fetch_error";

export type AgentFeedCheckResultInput = {
  readonly checkId: string;
  readonly feedId: bigint;
  readonly checkedAt: Date;
  readonly outcome: AgentFeedCheckOutcome;
  readonly httpStatus: number;
  readonly errorCode: string | null;
  readonly tierAttempted: number;
  readonly responseEtag: string | null;
  readonly responseLastModified: string | null;
  readonly feedTitle: string | null;
};

export type AgentFeedCheckResultsRequest = {
  readonly flushId: string | null;
  readonly sentAt: Date | null;
  readonly results: readonly AgentFeedCheckResultInput[];
};

export type AgentFeedCheckResultsWriteInput = AgentFeedCheckResultsRequest & {
  readonly receivedAt: Date;
};

export type AgentFeedCheckResultsWriteResult = {
  readonly accepted: number;
  readonly feedStateUpdated: number;
  readonly idempotentReplayCount: number;
  readonly outOfOrderResultCount: number;
};

export type AgentFeedCheckResultsResponse = {
  readonly accepted: number;
  readonly feed_state_updated: number;
  readonly idempotent_replay_count: number;
  readonly out_of_order_result_count: number;
};

export type AgentFeedCheckResultsValidationErrorCode =
  | "VALIDATION_FAILED"
  | "FEED_CHECK_RESULTS_EMPTY"
  | "CHECKED_AT_TOO_OLD"
  | "CHECKED_AT_IN_FUTURE"
  | "CHECK_ID_PAYLOAD_MISMATCH"
  | "FEED_TITLE_NOT_ALLOWED_FOR_OUTCOME"
  | "FEED_TITLE_EMPTY"
  | "FEED_TITLE_TOO_LONG";

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly errorCode: AgentFeedCheckResultsValidationErrorCode;
    };
