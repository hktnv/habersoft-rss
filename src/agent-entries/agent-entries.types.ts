export type DetailExtractionStatus =
  | "ok"
  | "timeout"
  | "playwright_failed"
  | "blocked"
  | "empty_content"
  | "normalizer_rejected"
  | "skipped_budget_exceeded";

export type DetailExtractionInput = {
  readonly status: DetailExtractionStatus;
  readonly attemptedAt: Date | null;
  readonly finalizedAt: Date;
  readonly errorCode: string | null;
};

export type AgentEntryInput = {
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly summary: string | null;
  readonly images: readonly string[] | null;
  readonly videos: readonly string[] | null;
  readonly tags: readonly string[] | null;
  readonly author: string | null;
  readonly meta: Record<string, unknown> | null;
  readonly publishedAt: Date | null;
  readonly detail: string | null;
  readonly detailExtraction: DetailExtractionInput;
};

export type AgentEntriesRequest = {
  readonly checkId: string;
  readonly feedId: bigint;
  readonly checkedAt: Date;
  readonly tierAttempted: number;
  readonly feedTitle: string | null;
  readonly responseEtag: string | null;
  readonly responseLastModified: string | null;
  readonly entries: readonly AgentEntryInput[];
};

export type AgentEntriesWriteInput = AgentEntriesRequest & {
  readonly receivedAt: Date;
};

export type AgentEntriesWriteResult = {
  readonly entriesSavedCount: number;
  readonly replay: boolean;
};

export type AgentEntriesResponse = {
  readonly ok: true;
  readonly check_id: string;
  readonly feed_id: string;
  readonly entries_submitted_count: number;
  readonly entries_saved_count: number;
  readonly replay: boolean;
};

export type AgentEntriesValidationErrorCode =
  | "VALIDATION_FAILED"
  | "CHECKED_AT_TOO_OLD"
  | "CHECKED_AT_IN_FUTURE"
  | "CHECK_ID_PAYLOAD_MISMATCH";

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly errorCode: AgentEntriesValidationErrorCode;
    };
