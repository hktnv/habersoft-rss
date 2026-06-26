export type TenantRateLimitConsumeResult =
  | {
      readonly outcome: "allowed";
    }
  | {
      readonly outcome: "limited";
      readonly retryAfterSeconds: number;
    }
  | {
      readonly outcome: "unavailable";
    };

export type TenantRateLimitStoreConsumeResult =
  | {
      readonly ok: true;
      readonly count: number;
    }
  | {
      readonly ok: false;
    };

export type TenantRateLimitStoreRetryResult =
  | {
      readonly ok: true;
      readonly retryAfterSeconds: number;
    }
  | {
      readonly ok: false;
    };

export interface TenantRateLimitStore {
  consume(key: string, windowSeconds: number): Promise<TenantRateLimitStoreConsumeResult>;
  retryAfterSeconds(key: string): Promise<TenantRateLimitStoreRetryResult>;
  supportsAtomicWindowCounter(): Promise<boolean>;
}
