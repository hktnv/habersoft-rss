import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  delete window.__RSS_ADMIN_UI_CONFIG__;
  vi.restoreAllMocks();
});

describe("admin UI authenticated status shell", () => {
  it("renders the status dashboard only after an authenticated admin session", async () => {
    vi.stubGlobal("fetch", authenticatedFetch());

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Admin session active" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Operations Overview" })).toBeInTheDocument();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Read-only Status Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("READ_ONLY_STATUS_DASHBOARD_PRODUCTION_TRANSPORT_ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED")).toBeInTheDocument();
    expect(screen.getByText("OUT_OF_SCOPE")).toBeInTheDocument();
  });

  it("uses same-origin auth and health routes without rendering an upstream URL", async () => {
    const fetch = authenticatedFetch();
    vi.stubGlobal("fetch", fetch);
    window.__RSS_ADMIN_UI_CONFIG__ = {
      environmentName: "local"
    };

    render(<App />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/admin-auth/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "/admin-api/operations/summary",
      expect.objectContaining({ method: "GET", credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "/admin-api/operations/drilldown",
      expect.objectContaining({ method: "GET", credentials: "same-origin" })
    );
    expect(fetch).toHaveBeenCalledWith("/status-api/health/live", expect.any(Object));
    expect(screen.queryByText("http://localhost:3200")).not.toBeInTheDocument();
  });

  it("keeps the dashboard hidden when admin auth is not configured", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          status: "not_configured",
          authenticated: false,
          message: "Admin authentication is not configured."
        },
        501
      )
    );
    vi.stubGlobal("fetch", fetch);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Admin authentication is not configured" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Read-only Status Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operations Overview" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(
      "/admin-api/operations/summary",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).not.toHaveBeenCalledWith(
      "/admin-api/operations/drilldown",
      expect.objectContaining({ method: "GET" })
    );
  });
});

function authenticatedFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/admin-auth/session") {
      return Promise.resolve(
        jsonResponse({
        configured: true,
        authenticated: true,
        principal: {
          kind: "single_admin",
          displayName: "Admin"
        },
        expiresAt: "2026-06-20T00:00:00.000Z",
        csrfToken: csrfToken
        })
      );
    }
    if (path === "/admin-api/operations/summary") {
      return Promise.resolve(
        jsonResponse({
          status: "ok",
          generatedAt: "2026-06-30T06:00:00.000Z",
          window: { recentHours: 24 },
          dependencies: { postgres: "up", redis: "up", tenantAuth: "up" },
          feeds: { total: 12, active: 10, disabled: 2, dueNow: 3 },
          entries: { total: 40, createdLast24h: 6 },
          ingestion: {
            checksLast24h: 7,
            successLast24h: 6,
            failedLast24h: 1,
            latestCheckAt: "2026-06-30T05:00:00.000Z"
          },
          notes: [{ code: "summary_is_aggregate_only", message: "Aggregate counts only." }]
        })
      );
    }
    if (path === "/admin-api/operations/drilldown") {
      return Promise.resolve(
        jsonResponse({
          status: "ok",
          generatedAt: "2026-06-30T06:00:00.000Z",
          window: { recentHours: 24, maxRows: 20 },
          feeds: {
            status: "ok",
            total: 1,
            active: 1,
            due: 0,
            withRecentSuccess: 1,
            withRecentFailure: 0,
            rows: [
              {
                displayId: "feed_123456abcd",
                displayName: "Example News",
                sourceHost: "news.example.org",
                health: "healthy",
                lastCheckedAt: "2026-06-30T05:00:00.000Z",
                lastResult: "success",
                recentEntryCount: 1,
                notes: [],
                canRequestRecheck: true,
                recheckUnavailableReason: null,
                actionRef
              }
            ]
          },
          ingestion: {
            status: "ok",
            recentEntryCount: 1,
            recentBatchCount: 1,
            latestEntryAt: "2026-06-30T05:55:00.000Z",
            rows: [
              {
                displayId: "check_abcdef1234",
                feedDisplayId: "feed_123456abcd",
                receivedAt: "2026-06-30T05:45:00.000Z",
                entryCount: 1,
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
        })
      );
    }
    if (path === "/status-api/health/live") {
      return Promise.resolve(jsonResponse({ status: "live" }));
    }
    if (path === "/status-api/health/ready") {
      return Promise.resolve(
        jsonResponse({
        status: "ready",
        dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
        })
      );
    }
    return Promise.resolve(jsonResponse({ status: "not_found" }, 404));
  });
}

const actionRef = `feed_recheck_v1.${"A".repeat(64)}`;
const csrfToken = "csrf_token_value_at_least_32_characters";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
