import { CleanupRunFailedError, CleanupOrchestrator } from "../../../src/maintenance/cleanup.orchestrator";
import type { CleanupTelemetry } from "../../../src/maintenance/cleanup.telemetry";
import type { CleanupStepExecutor } from "../../../src/maintenance/cleanup.types";

describe("CleanupOrchestrator", () => {
  it("runs all seven cleanup steps in canonical order and records a successful summary", async () => {
    const calls: string[] = [];
    const orchestrator = new CleanupOrchestrator(executor(calls), silentTelemetry());

    const summary = await orchestrator.run({ jobId: "job-1", attempt: 1, runCorrelationId: "run-1" });

    expect(calls).toEqual([
      "entries_age",
      "entries_cap",
      "entry_details_age",
      "entry_details_cap",
      "agent_feed_check_events_age",
      "vacuum_analyze"
    ]);
    expect(summary.terminalStatus).toBe("succeeded");
    expect(summary.steps.map((step) => step.step)).toEqual([
      "entries_age",
      "entries_cap",
      "entry_details_age",
      "entry_details_cap",
      "agent_feed_check_events_age",
      "vacuum_analyze",
      "run_summary"
    ]);
  });

  it("continues after a step failure and marks the run terminal failed after summary", async () => {
    const calls: string[] = [];
    const failing = executor(calls, "entries_cap");
    const orchestrator = new CleanupOrchestrator(failing, silentTelemetry());

    await expect(orchestrator.run({ jobId: "job-2", attempt: 1, runCorrelationId: "run-2" })).rejects.toBeInstanceOf(
      CleanupRunFailedError
    );
    expect(calls).toEqual([
      "entries_age",
      "entries_cap",
      "entry_details_age",
      "entry_details_cap",
      "agent_feed_check_events_age",
      "vacuum_analyze"
    ]);
  });
});

function executor(calls: string[], failingStep?: string): CleanupStepExecutor {
  function run(step: string, rows: number): Promise<number> {
    calls.push(step);
    if (step === failingStep) {
      throw new Error("controlled failure");
    }

    return Promise.resolve(rows);
  }

  return {
    runEntriesAgeRetention: () => run("entries_age", 1),
    runEntriesPerFeedCap: () => run("entries_cap", 2),
    runEntryDetailsAgeRetention: () => run("entry_details_age", 3),
    runEntryDetailsPerFeedCap: () => run("entry_details_cap", 4),
    runAgentFeedCheckEventsAgeRetention: () => run("agent_feed_check_events_age", 5),
    runVacuumAnalyze: () => run("vacuum_analyze", 3)
  };
}

function silentTelemetry(): CleanupTelemetry {
  return {
    recordStep: jest.fn(),
    recordRun: jest.fn()
  } as unknown as CleanupTelemetry;
}
