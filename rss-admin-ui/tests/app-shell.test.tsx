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
    expect(await screen.findByRole("heading", { name: "Read-only Status Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("READ_ONLY_STATUS_DASHBOARD_PRODUCTION_TRANSPORT_ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("AUTH_NOT_CONFIGURED_RESIDUAL")).toBeInTheDocument();
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
    expect(fetch).toHaveBeenCalledWith("/status-api/health/live", expect.any(Object));
    expect(screen.queryByText("http://localhost:3200")).not.toBeInTheDocument();
  });

  it("keeps the dashboard hidden when admin auth is not configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            status: "not_configured",
            authenticated: false,
            message: "Admin authentication is not configured."
          },
          501
        )
      )
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Admin authentication is not configured" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Read-only Status Dashboard" })).not.toBeInTheDocument();
  });
});

function authenticatedFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        configured: true,
        authenticated: true,
        principal: {
          kind: "single_admin",
          displayName: "Admin"
        },
        expiresAt: "2026-06-20T00:00:00.000Z"
      })
    )
    .mockResolvedValueOnce(jsonResponse({ status: "live" }))
    .mockResolvedValueOnce(
      jsonResponse({
        status: "ready",
        dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
      })
    );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
