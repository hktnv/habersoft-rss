import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationsOverview } from "../src/adminOperations/OperationsOverview";
import type { OperationsDrilldownResult } from "../src/adminOperations/operationsDrilldownClient";
import type { OperationsSummary, OperationsSummaryResult } from "../src/adminOperations/operationsSummaryClient";

describe("OperationsOverview", () => {
  it("renders validated aggregate metrics and supports manual refresh", async () => {
    const loadSummary = vi
      .fn<(options?: { readonly signal?: AbortSignal }) => Promise<OperationsSummaryResult>>()
      .mockResolvedValueOnce(successResult({ feeds: { total: 10, active: 8, disabled: 2, dueNow: 1 } }))
      .mockResolvedValueOnce(successResult({ feeds: { total: 11, active: 9, disabled: 2, dueNow: 0 } }));

    render(<OperationsOverview loadSummary={loadSummary} loadDrilldown={mockDrilldown} />);

    expect(await screen.findByRole("heading", { name: "Operations Overview" })).toBeInTheDocument();
    expect(await screen.findByText("10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("11")).toBeInTheDocument();
    expect(loadSummary).toHaveBeenCalledTimes(2);
  });

  it("shows operator-safe remediation when the protected API is unavailable", async () => {
    const loadSummary = vi.fn().mockResolvedValue({
      kind: "unavailable",
      httpStatus: 502,
      message: "Admin operations API is unavailable."
    } satisfies OperationsSummaryResult);

    render(<OperationsOverview loadSummary={loadSummary} loadDrilldown={mockDrilldown} />);

    expect(await screen.findByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText(/frontend canonical helper recreate/iu)).toBeInTheDocument();
    expect(screen.queryByText(/stack trace|database_url|token/iu)).not.toBeInTheDocument();
  });
});

function successResult(overrides: Partial<OperationsSummary> = {}): OperationsSummaryResult {
  const summary = {
    status: "ok" as const,
    generatedAt: "2026-06-30T06:00:00.000Z",
    window: { recentHours: 24 as const },
    dependencies: { postgres: "up" as const, redis: "up" as const, tenantAuth: "up" as const },
    feeds: { total: 10, active: 8, disabled: 2, dueNow: 1 },
    entries: { total: 100, createdLast24h: 12 },
    ingestion: {
      checksLast24h: 9,
      successLast24h: 7,
      failedLast24h: 1,
      latestCheckAt: "2026-06-30T05:00:00.000Z"
    },
    notes: [{ code: "summary_is_aggregate_only", message: "Aggregate counts only." }],
    ...overrides
  };
  return { kind: "success", httpStatus: 200, summary };
}

const mockDrilldown = vi.fn<(options?: { readonly signal?: AbortSignal }) => Promise<OperationsDrilldownResult>>().mockResolvedValue({
  kind: "success",
  httpStatus: 200,
  drilldown: {
    status: "ok",
    generatedAt: "2026-06-30T06:00:00.000Z",
    window: { recentHours: 24, maxRows: 20 },
    feeds: {
      status: "ok",
      total: 0,
      active: 0,
      due: 0,
      withRecentSuccess: 0,
      withRecentFailure: 0,
      rows: []
    },
    ingestion: {
      status: "ok",
      recentEntryCount: 0,
      recentBatchCount: 0,
      latestEntryAt: null,
      rows: []
    },
    notes: ["Drilldown rows are bounded and safe."],
    capabilities: {
      feedRows: true,
      ingestionRows: true,
      reason: null
    }
  }
});
