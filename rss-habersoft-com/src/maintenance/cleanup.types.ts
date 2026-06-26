import type { CleanupStepId } from "./maintenance.registry";

export type CleanupStepStatus = "succeeded" | "failed";
export type CleanupRunTerminalStatus = "succeeded" | "failed";

export type CleanupStepResult = {
  readonly step: CleanupStepId;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly affectedRows: number;
  readonly status: CleanupStepStatus;
  readonly safeFailureClass: string | null;
};

export type CleanupRunSummary = {
  readonly operation: "cleanup_run";
  readonly queue: string;
  readonly jobName: string;
  readonly jobId: string;
  readonly schedulerId: string;
  readonly attempt: number;
  readonly runCorrelationId: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly terminalStatus: CleanupRunTerminalStatus;
  readonly steps: readonly CleanupStepResult[];
};

export interface CleanupStepExecutor {
  runEntriesAgeRetention(): Promise<number>;
  runEntriesPerFeedCap(): Promise<number>;
  runEntryDetailsAgeRetention(): Promise<number>;
  runEntryDetailsPerFeedCap(): Promise<number>;
  runAgentFeedCheckEventsAgeRetention(): Promise<number>;
  runVacuumAnalyze(): Promise<number>;
}
