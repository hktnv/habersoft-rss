import { Injectable } from "@nestjs/common";
import type { CleanupRunSummary, CleanupStepResult } from "./cleanup.types";

@Injectable()
export class CleanupTelemetry {
  public recordStep(result: CleanupStepResult): void {
    const payload = {
      operation: "cleanup_step",
      step: result.step,
      status: result.status,
      duration_ms: result.durationMs,
      affected_rows: result.affectedRows,
      safe_failure_class: result.safeFailureClass
    };

    if (result.status === "failed") {
      console.warn(JSON.stringify({ ...payload, signal: `cleanup_step_failed{step=${result.step}}` }));
      return;
    }

    console.info(JSON.stringify(payload));
  }

  public recordRun(summary: CleanupRunSummary): void {
    console.info(
      JSON.stringify({
        operation: summary.operation,
        queue: summary.queue,
        job_name: summary.jobName,
        job_id: summary.jobId,
        scheduler_id: summary.schedulerId,
        attempt: summary.attempt,
        run_correlation_id: summary.runCorrelationId,
        started_at: summary.startedAt.toISOString(),
        finished_at: summary.finishedAt.toISOString(),
        duration_ms: summary.durationMs,
        terminal_status: summary.terminalStatus,
        steps: summary.steps.map((step) => ({
          step: step.step,
          status: step.status,
          duration_ms: step.durationMs,
          affected_rows: step.affectedRows,
          safe_failure_class: step.safeFailureClass
        }))
      })
    );
  }
}
