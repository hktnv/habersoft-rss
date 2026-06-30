import type { DependencyState } from "../persistence/postgres.service";

export type AdminOperationsDependencyState = DependencyState | "unknown";

export type AdminOperationsSummary = {
  readonly status: "ok";
  readonly generatedAt: string;
  readonly window: {
    readonly recentHours: 24;
  };
  readonly dependencies: {
    readonly postgres: AdminOperationsDependencyState;
    readonly redis: AdminOperationsDependencyState;
    readonly tenantAuth: AdminOperationsDependencyState;
  };
  readonly feeds: {
    readonly total: number | null;
    readonly active: number | null;
    readonly disabled: number | null;
    readonly dueNow: number | null;
  };
  readonly entries: {
    readonly total: number | null;
    readonly createdLast24h: number | null;
  };
  readonly ingestion: {
    readonly checksLast24h: number | null;
    readonly successLast24h: number | null;
    readonly failedLast24h: number | null;
    readonly latestCheckAt: string | null;
  };
  readonly notes: readonly AdminOperationsSummaryNote[];
};

export type AdminOperationsSummaryNote = {
  readonly code: string;
  readonly message: string;
};
