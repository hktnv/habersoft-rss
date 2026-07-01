import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationsDrilldown } from "../src/adminOperations/OperationsDrilldown";
import type { OperationsDrilldown as OperationsDrilldownData, OperationsDrilldownResult } from "../src/adminOperations/operationsDrilldownClient";
import type { FeedOnboardingResult } from "../src/adminOperations/feedOnboardingClient";
import type { FeedRecheckResult } from "../src/adminOperations/feedRecheckClient";

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

  it("requires explicit confirmation before requesting a feed recheck", async () => {
    const requestRecheck = vi.fn<(options: { readonly actionRef: string; readonly csrfToken: string; readonly signal?: AbortSignal }) => Promise<FeedRecheckResult>>()
      .mockResolvedValue({
        kind: "accepted",
        httpStatus: 202,
        response: {
          status: "accepted",
          requestId: "recheck_abc123def456",
          target: {
            displayId: "feed_123456abcd",
            sourceHost: "news.example.org"
          },
          queued: true,
          cooldownSeconds: 300,
          message: "Feed recheck was requested through the existing due-feed path.",
          generatedAt: "2026-06-30T06:01:00.000Z"
        }
      });

    render(<OperationsDrilldown loadDrilldown={vi.fn().mockResolvedValue(successResult())} csrfToken={csrfToken} requestRecheck={requestRecheck} />);

    fireEvent.click(await screen.findByRole("button", { name: "Request recheck" }));
    expect(screen.getByText("Request a safe recheck for this feed?")).toBeInTheDocument();
    expect(requestRecheck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Feed recheck was requested through the existing due-feed path.")).toBeInTheDocument();
    expect(requestRecheck).toHaveBeenCalledWith(expect.objectContaining({
      actionRef,
      csrfToken
    }));
  });

  it("submits feed onboarding with explicit confirmation and renders only safe response fields", async () => {
    const requestOnboarding = vi.fn<(options: { readonly feedUrl: string; readonly label?: string; readonly csrfToken: string; readonly signal?: AbortSignal }) => Promise<FeedOnboardingResult>>()
      .mockResolvedValue({
        kind: "created",
        httpStatus: 201,
        response: {
          status: "created",
          requestRef: "onboard_abc123def456",
          feed: {
            displayId: "feed_123456abcd",
            sourceHost: "news.example.org",
            state: "active",
            eligibleForRecheck: true
          },
          nextSteps: ["Refresh Operations Drilldown."],
          message: "Feed onboarding was accepted through the existing due-feed path.",
          generatedAt: "2026-07-01T06:00:00.000Z"
        }
      });
    const onAccepted = vi.fn();

    render(
      <OperationsDrilldown
        loadDrilldown={vi.fn().mockResolvedValue(successResult({ feeds: { ...validDrilldown().feeds, rows: [] }, ingestion: { ...validDrilldown().ingestion, rows: [] } }))}
        csrfToken={csrfToken}
        requestOnboarding={requestOnboarding}
        onFeedOnboardingAccepted={onAccepted}
      />
    );

    fireEvent.change(await screen.findByLabelText("Feed URL"), { target: { value: "https://news.example.org/feed.xml?private=1" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Example News" } });
    fireEvent.click(screen.getByLabelText("This creates a real feed target after operator deployment."));
    fireEvent.click(screen.getByRole("button", { name: "Onboard feed" }));

    expect(await screen.findByText("Feed onboarding was accepted through the existing due-feed path.")).toBeInTheDocument();
    expect(screen.getByText("feed_123456abcd")).toBeInTheDocument();
    expect(screen.getByText("news.example.org")).toBeInTheDocument();
    expect(screen.queryByText(/private=1|feed\.xml|onboard_abc123def456/iu)).not.toBeInTheDocument();
    expect(requestOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      feedUrl: "https://news.example.org/feed.xml?private=1",
      label: "Example News",
      csrfToken
    }));
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("copies redacted browser evidence without leaking action metadata", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(<OperationsDrilldown loadDrilldown={vi.fn().mockResolvedValue(successResult())} csrfToken={csrfToken} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy redacted evidence" }));

    expect(await screen.findByText("Redacted evidence copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY");
    expect(copied).not.toMatch(/feed_recheck_v1\.|csrf|cookie|https?:\/\//iu);
  });

  it("downloads redacted browser evidence JSON without exposing raw action metadata", async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn((blob: Blob) => {
      void blob;
      return "blob:redacted-evidence";
    });
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    try {
      render(<OperationsDrilldown loadDrilldown={vi.fn().mockResolvedValue(successResult())} csrfToken={csrfToken} />);

      fireEvent.click(await screen.findByRole("button", { name: "Download redacted evidence JSON" }));

      expect(await screen.findByText("Redacted evidence download prepared.")).toBeInTheDocument();
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      const blob = createObjectUrl.mock.calls[0]?.[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:redacted-evidence");
    } finally {
      click.mockRestore();
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectUrl });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectUrl });
    }
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
    expect(await screen.findByText("No eligible feed recheck target is currently available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request recheck" })).not.toBeInTheDocument();
  });

  it("classifies feed rows without actionRefs as no eligible recheck target", async () => {
    const loadDrilldown = vi.fn().mockResolvedValue(
      successResult({
        feeds: {
          ...validDrilldown().feeds,
          rows: [
            {
              ...validDrilldown().feeds.rows[0],
              canRequestRecheck: false,
              recheckUnavailableReason: "no_subscribers",
              actionRef: null
            }
          ]
        }
      })
    );

    render(<OperationsDrilldown loadDrilldown={loadDrilldown} csrfToken={csrfToken} />);

    expect(await screen.findByText("No eligible feed recheck target is currently available.")).toBeInTheDocument();
    expect(screen.getByText("No subscribers")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request recheck" })).not.toBeInTheDocument();
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
          notes: ["Latest check is degraded."],
          canRequestRecheck: true,
          recheckUnavailableReason: null,
          actionRef
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

const actionRef = `feed_recheck_v1.${"A".repeat(64)}`;
const csrfToken = "csrf_token_value_at_least_32_characters";
