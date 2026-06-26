import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  delete window.__RSS_ADMIN_UI_CONFIG__;
  vi.restoreAllMocks();
});

describe("admin UI read-only status shell", () => {
  it("renders the status dashboard and non-deployed status", async () => {
    vi.stubGlobal("fetch", healthyFetch());

    render(<App />);

    expect(screen.getByRole("heading", { name: "Read-only Status Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("READ_ONLY_STATUS_DASHBOARD_IMPLEMENTED")).toBeInTheDocument();
    expect(screen.getByText("NOT_DEPLOYED")).toBeInTheDocument();
    expect(screen.getByText("OUT_OF_SCOPE")).toBeInTheDocument();
  });

  it("uses runtime API configuration without rendering the full API URL", async () => {
    const fetch = healthyFetch();
    vi.stubGlobal("fetch", fetch);
    window.__RSS_ADMIN_UI_CONFIG__ = {
      apiBaseUrl: "http://localhost:3200/",
      environmentName: "local"
    };

    render(<App />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3200/health/live", expect.any(Object));
    expect(screen.queryByText("http://localhost:3200")).not.toBeInTheDocument();
  });
});

function healthyFetch() {
  return vi
    .fn()
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
