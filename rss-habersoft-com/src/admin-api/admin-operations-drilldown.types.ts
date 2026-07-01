export type AdminOperationsDrilldownStatus = "ok" | "partial" | "unavailable";

export type AdminOperationsFeedHealth = "healthy" | "degraded" | "unknown";

export type AdminOperationsLastResult = "success" | "failure" | "unknown";

export type AdminOperationsIngestionRowStatus = "accepted" | "skipped" | "unknown";

export type AdminOperationsDrilldown = {
  readonly status: AdminOperationsDrilldownStatus;
  readonly generatedAt: string;
  readonly window: {
    readonly recentHours: 24;
    readonly maxRows: 20;
  };
  readonly feeds: {
    readonly status: AdminOperationsDrilldownStatus;
    readonly total: number | null;
    readonly active: number | null;
    readonly due: number | null;
    readonly withRecentSuccess: number | null;
    readonly withRecentFailure: number | null;
    readonly rows: readonly AdminOperationsFeedRow[];
  };
  readonly ingestion: {
    readonly status: AdminOperationsDrilldownStatus;
    readonly recentEntryCount: number | null;
    readonly recentBatchCount: number | null;
    readonly latestEntryAt: string | null;
    readonly rows: readonly AdminOperationsIngestionRow[];
  };
  readonly notes: readonly string[];
  readonly capabilities: {
    readonly feedRows: boolean;
    readonly ingestionRows: boolean;
    readonly reason: string | null;
  };
};

export type AdminOperationsFeedRow = {
  readonly displayId: string;
  readonly displayName: string | null;
  readonly sourceHost: string | null;
  readonly health: AdminOperationsFeedHealth;
  readonly lastCheckedAt: string | null;
  readonly lastResult: AdminOperationsLastResult;
  readonly recentEntryCount: number | null;
  readonly notes: readonly string[];
};

export type AdminOperationsIngestionRow = {
  readonly displayId: string;
  readonly feedDisplayId: string | null;
  readonly receivedAt: string | null;
  readonly entryCount: number | null;
  readonly status: AdminOperationsIngestionRowStatus;
  readonly notes: readonly string[];
};
