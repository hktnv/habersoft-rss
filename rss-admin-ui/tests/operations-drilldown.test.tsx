import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationsDrilldown } from "../src/adminOperations/OperationsDrilldown";
import type { OperationsDrilldown as OperationsDrilldownData, OperationsDrilldownResult } from "../src/adminOperations/operationsDrilldownClient";

describe("OperationsDrilldown", () => {
  it("renders validated drilldown rows and supports manual refresh", async () => {
    const loadDrilldown = vi
      .fn<(options?: { readonly signal?: AbortSignal }) => Promise<OperationsDrilldownResult>>()
      .mockResolvedValueOnce(successResult({ feeds: { ...validDrilldown().feeds, total: 2 } }))
      .mockResolvedValueOnce(successResult({ feeds: { ...validDrilldown().feeds, total: 3 } }));

    render(<OperationsDrilldown loadDrilldown={loadDrilldown} />);

    expect(await screen.findByRole("heading", { name: "Operations Drilldown" })).toBeInTheDocument();
    expect(await screen.findByText("news.example.org")).toBeInTheDocument();
    expect((await screen.findAllByText("2")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh Drilldown" }));
    expect((await screen.findAllByText("3")).length).toBeGreaterThan(0);
    expect(loadDrilldown).toHaveBeenCalledTimes(2);
  });

  it("shows session-expired state without rendering drilldown rows", async () => {
    const loadDrilldown = vi.fn().mockResolvedValue({
      kind: "unauthenticated",
      httpStatus: 401,
      message: "Admin session expired."
    } satisfies OperationsDrilldownResult);

    render(<OperationsDrilldown loadDrilldown={loadDrilldown} />);

    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    expect(screen.getByText(/Sign in again/iu)).toBeInTheDocument();
    expect(screen.queryByText("news.example.org")).not.toBeInTheDocument();
  });

  it("renders partial, unavailable, and empty states with safe copy", async () => {
    const loadPartial = vi.fn().mockResolvedValue(
      successResult({
        status: "partial",
        feeds: { ...validDrilldown().feeds, status: "unavailable", rows: [] },
        capabilities: {
          feedRows: false,
          ingestionRows: true,
          reason: "Some drilldown data could not be read safely."
        }
      })
    );
    const { unmount } = render(<OperationsDrilldown loadDrilldown={loadPartial} />);

    expect(await screen.findByText("partial")).toBeInTheDocument();
    expect(screen.getByText("Some drilldown data could not be read safely.")).toBeInTheDocument();
    expect(screen.queryByText(/stack trace|database_url|token=/iu)).not.toBeInTheDocument();
    unmount();

    const loadEmpty = vi.fn().mockResolvedValue(
      successResult({
        feeds: { ...validDrilldown().feeds, rows: [] },
        ingestion: { ...validDrilldown().ingestion, rows: [] }
      })
    );
    render(<OperationsDrilldown loadDrilldown={loadEmpty} />);
    expect(await screen.findByText("No recent drilldown rows")).toBeInTheDocument();
  });

  it("shows invalid or unavailable response states safely", async () => {
    const loadDrilldown = vi.fn().mockResolvedValue({
      kind: "invalid_response",
      httpStatus: 200,
      message: "Admin operations drilldown response could not be validated."
    } satisfies OperationsDrilldownResult);

    render(<OperationsDrilldown loadDrilldown={loadDrilldown} />);

    expect(await screen.findByText("invalid_response")).toBeInTheDocument();
    expect(screen.getByText(/could not be validated/iu)).toBeInTheDocument();
    expect(screen.queryByText(/<html|raw-check-id|https:\/\/news/iu)).not.toBeInTheDocument();
  });
});

function successResult(overrides: Partial<OperationsDrilldownData> = {}): OperationsDrilldownResult {
  const drilldown = {
    ...validDrilldown(),
    ...overrides
  };
  return { kind: "success", httpStatus: 200, drilldown };
}

function validDrilldown(): OperationsDrilldownData {
  return {
    status: "ok",
    generatedAt: "2026-06-30T06:00:00.000Z",
    window: { recentHours: 24, maxRows: 20 },
    feeds: {
      status: "ok",
      total: 2,
      active: 1,
      due: 1,
      withRecentSuccess: 1,
      withRecentFailure: 1,
      rows: [
        {
          displayId: "feed_123456abcd",
          displayName: "Example News",
          sourceHost: "news.example.org",
          health: "degraded",
          lastCheckedAt: "2026-06-30T05:00:00.000Z",
          lastResult: "failure",
          recentEntryCount: 3,
          notes: ["Latest check is degraded."]
        }
      ]
    },
    ingestion: {
      status: "ok",
      recentEntryCount: 3,
      recentBatchCount: 2,
      latestEntryAt: "2026-06-30T05:55:00.000Z",
      rows: [
        {
          displayId: "check_abcdef1234",
          feedDisplayId: "feed_123456abcd",
          receivedAt: "2026-06-30T05:45:00.000Z",
          entryCount: 2,
          status: "accepted",
          notes: []
        }
      ]
    },
    notes: ["Drilldown rows are bounded and safe."],
    capabilities: {
      feedRows: true,
      ingestionRows: true,
      reason: null
    }
  };
}
