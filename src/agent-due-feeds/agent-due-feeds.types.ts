export type AgentDueFeedsQuery = {
  readonly limit: number;
};

export type DueFeedReadInput = {
  readonly limit: number;
  readonly serverNow: Date;
};

export type DueFeedRecord = {
  readonly id: bigint;
  readonly url: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
};

export type DueFeedResponseItem = {
  readonly feed_id: string;
  readonly url: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
};

export type DueFeedResponse = {
  readonly feeds: readonly DueFeedResponseItem[];
  readonly feed_poll_interval_seconds: number;
  readonly has_more_due: boolean;
};

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
    };
