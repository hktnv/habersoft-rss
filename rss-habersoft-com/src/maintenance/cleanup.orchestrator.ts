import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CleanupTelemetry } from "./cleanup.telemetry";
import type { CleanupRunSummary, CleanupStepExecutor, CleanupStepResult } from "./cleanup.types";
import { CLEANUP_DAILY_SCHEDULER_ID, CLEANUP_RUN_JOB_NAME, MAINTENANCE_QUEUE_NAME } from "./maintenance.registry";

type CleanupRunInput = {
  readonly jobId: string;
  readonly attempt: number;
  readonly runCorrelationId?: string;
};

type StepCall = {
  readonly step: CleanupStepResult["step"];
  readonly run: () => Promise<number>;
};

export class CleanupRunFailedError extends Error {
  public readonly summary: CleanupRunSummary;

  public constructor(summary: CleanupRunSummary) {
    super("cleanup run completed with one or more failed steps");
    this.name = "CleanupRunFailedError";
    this.summary = summary;
  }
}

@Injectable()
export class CleanupOrchestrator {
  public constructor(
    private readonly steps: CleanupStepExecutor,
    private readonly telemetry: CleanupTelemetry
  ) {}

  public async run(input: CleanupRunInput): Promise<CleanupRunSummary> {
    const runStartedAt = new Date();
    const runCorrelationId = input.runCorrelationId ?? randomUUID();
    const stepResults: CleanupStepResult[] = [];

    const steps: readonly StepCall[] = [
      { step: "entries_age", run: () => this.steps.runEntriesAgeRetention() },
      { step: "entries_cap", run: () => this.steps.runEntriesPerFeedCap() },
      { step: "entry_details_age", run: () => this.steps.runEntryDetailsAgeRetention() },
      { step: "entry_details_cap", run: () => this.steps.runEntryDetailsPerFeedCap() },
      { step: "agent_feed_check_events_age", run: () => this.steps.runAgentFeedCheckEventsAgeRetention() },
      { step: "vacuum_analyze", run: () => this.steps.runVacuumAnalyze() }
    ];

    for (const step of steps) {
      const result = await this.runStep(step);
      stepResults.push(result);
      this.telemetry.recordStep(result);
    }

    const summaryStep = this.summarizeStep();
    stepResults.push(summaryStep);
    this.telemetry.recordStep(summaryStep);

    const runFinishedAt = new Date();
    const terminalStatus = stepResults.some((step) => step.status === "failed") ? "failed" : "succeeded";
    const summary: CleanupRunSummary = {
      operation: "cleanup_run",
      queue: MAINTENANCE_QUEUE_NAME,
      jobName: CLEANUP_RUN_JOB_NAME,
      jobId: input.jobId,
      schedulerId: CLEANUP_DAILY_SCHEDULER_ID,
      attempt: input.attempt,
      runCorrelationId,
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      durationMs: runFinishedAt.getTime() - runStartedAt.getTime(),
      terminalStatus,
      steps: stepResults
    };

    this.telemetry.recordRun(summary);

    if (terminalStatus === "failed") {
      throw new CleanupRunFailedError(summary);
    }

    return summary;
  }

  private async runStep(step: StepCall): Promise<CleanupStepResult> {
    const startedAt = new Date();

    try {
      const affectedRows = await step.run();
      const finishedAt = new Date();
      return {
        step: step.step,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        affectedRows,
        status: "succeeded",
        safeFailureClass: null
      };
    } catch (error: unknown) {
      const finishedAt = new Date();
      return {
        step: step.step,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        affectedRows: 0,
        status: "failed",
        safeFailureClass: classifyFailure(error)
      };
    }
  }

  private summarizeStep(): CleanupStepResult {
    const now = new Date();
    return {
      step: "run_summary",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      affectedRows: 0,
      status: "succeeded",
      safeFailureClass: null
    };
  }
}

function classifyFailure(error: unknown): string {
  if (error instanceof Error && error.name !== "Error") {
    return error.name;
  }

  return "cleanup_step_error";
}
