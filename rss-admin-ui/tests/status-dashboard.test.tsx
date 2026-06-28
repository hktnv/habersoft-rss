import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUiConfig } from "../src/config/adminUiConfig";
import { StatusDashboard } from "../src/status/StatusDashboard";
import type { HealthObservation, ObserveBackendHealthOptions } from "../src/status/healthClient";

type ObserveHealthMock = (
  options?: ObserveBackendHealthOptions
) => Promise<HealthObservation>;

const config: AdminUiConfig = {
  environmentName: "operator-local"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("read-only status dashboard", () => {
  it("renders the initial loading state with accessible controls", () => {
    const observation = deferred<HealthObservation>();
    const observeHealth = vi.fn<ObserveHealthMock>().mockReturnValue(observation.promise);

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(screen.getByRole("heading", { name: "Read-only Status Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByText("Checking public health endpoints...")).toBeInTheDocument();
  });

  it("renders healthy live, ready, dependencies, last checked, and neutral environment label", async () => {
    const observeHealth = vi.fn<ObserveHealthMock>().mockResolvedValue(healthyObservation("2026-06-20T00:00:00.000Z"));

    render(
      <StatusDashboard
        config={{ environmentName: "production" }}
        observeHealth={observeHealth}
      />
    );

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Environment label:")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("(configuration label only)")).toBeInTheDocument();
    expect(screen.getByText("2026-06-20T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("Tenant auth")).toBeInTheDocument();
    expect(screen.queryByText(/production healthy/iu)).not.toBeInTheDocument();
    expect(screen.queryByText("http://api.example.test")).not.toBeInTheDocument();
  });

  it("renders degraded readiness and dependency state", async () => {
    const observeHealth = vi.fn<ObserveHealthMock>().mockResolvedValue(
      degradedObservation("2026-06-20T00:01:00.000Z")
    );

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("not_ready")).toBeInTheDocument();
    expect(screen.getByText("Liveness is established, but readiness or a dependency is not up.")).toBeInTheDocument();
    expect(screen.getByText("down")).toBeInTheDocument();
  });

  it("renders unavailable liveness safely", async () => {
    const observeHealth = vi.fn<ObserveHealthMock>().mockResolvedValue(
      unavailableObservation("2026-06-20T00:02:00.000Z")
    );

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Liveness could not be safely established.")).toBeInTheDocument();
    expect(screen.getByText("The health endpoint returned an unexpected HTTP status.")).toBeInTheDocument();
    expect(screen.queryByText(/raw backend body|stack trace|postgresql:\/\//iu)).not.toBeInTheDocument();
  });

  it("renders partial malformed readiness safely", async () => {
    const observeHealth = vi.fn<ObserveHealthMock>().mockResolvedValue(
      partialObservation("2026-06-20T00:03:00.000Z")
    );

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(await screen.findByText("Partial")).toBeInTheDocument();
    expect(screen.getByText("The health response did not match the expected public contract.")).toBeInTheDocument();
    expect(screen.getByText("Dependency states are available only after a valid readiness response.")).toBeInTheDocument();
  });

  it("supports manual refresh, busy state, and last-checked update only after completion", async () => {
    const refresh = deferred<HealthObservation>();
    const observeHealth = vi
      .fn<ObserveHealthMock>()
      .mockResolvedValueOnce(healthyObservation("2026-06-20T00:00:00.000Z"))
      .mockReturnValueOnce(refresh.promise);
    const user = userEvent.setup();

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
    expect(screen.getByText("2026-06-20T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText(/Refreshing; previous completed observation remains visible/u)).toBeInTheDocument();

    refresh.resolve(degradedObservation("2026-06-20T00:05:00.000Z"));

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("2026-06-20T00:05:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-20T00:00:00.000Z")).not.toBeInTheDocument();
  });

  it("prevents an older observation from overwriting a newer one", async () => {
    const first = deferred<HealthObservation>();
    const second = deferred<HealthObservation>();
    const observeHealth = vi.fn<ObserveHealthMock>().mockReturnValueOnce(first.promise);
    const nextObserveHealth = vi.fn<ObserveHealthMock>().mockReturnValueOnce(second.promise);
    const firstConfig = { environmentName: "first" };
    const secondConfig = { environmentName: "second" };

    const { rerender } = render(<StatusDashboard config={firstConfig} observeHealth={observeHealth} />);
    rerender(<StatusDashboard config={secondConfig} observeHealth={nextObserveHealth} />);

    second.resolve(healthyObservation("2026-06-20T00:10:00.000Z"));
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("2026-06-20T00:10:00.000Z")).toBeInTheDocument();

    first.resolve(unavailableObservation("2026-06-20T00:09:00.000Z"));
    await waitFor(() => {
      expect(screen.queryByText("2026-06-20T00:09:00.000Z")).not.toBeInTheDocument();
    });
    expect(screen.getByText("2026-06-20T00:10:00.000Z")).toBeInTheDocument();
  });

  it("does not call browser persistence APIs", async () => {
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const storageGet = vi.spyOn(Storage.prototype, "getItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const storageClear = vi.spyOn(Storage.prototype, "clear");
    const observeHealth = vi.fn<ObserveHealthMock>().mockResolvedValue(healthyObservation("2026-06-20T00:00:00.000Z"));

    render(<StatusDashboard config={config} observeHealth={observeHealth} />);

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(storageClear).not.toHaveBeenCalled();
  });
});

function healthyObservation(observedAt: string): HealthObservation {
  return {
    observedAt,
    overall: "healthy",
    live: {
      ok: true,
      endpoint: "live",
      httpStatus: 200,
      payload: { status: "live" }
    },
    ready: {
      ok: true,
      endpoint: "ready",
      httpStatus: 200,
      payload: {
        status: "ready",
        dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
      }
    }
  };
}

function degradedObservation(observedAt: string): HealthObservation {
  return {
    observedAt,
    overall: "degraded",
    live: {
      ok: true,
      endpoint: "live",
      httpStatus: 200,
      payload: { status: "live" }
    },
    ready: {
      ok: true,
      endpoint: "ready",
      httpStatus: 503,
      payload: {
        status: "not_ready",
        dependencies: { postgres: "up", redis: "down", tenantAuth: "up" }
      }
    }
  };
}

function unavailableObservation(observedAt: string): HealthObservation {
  return {
    observedAt,
    overall: "unavailable",
    live: {
      ok: false,
      endpoint: "live",
      httpStatus: 500,
      error: {
        code: "http_status_unaccepted",
        message: "The health endpoint returned an unexpected HTTP status."
      }
    },
    ready: {
      ok: true,
      endpoint: "ready",
      httpStatus: 200,
      payload: {
        status: "ready",
        dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
      }
    }
  };
}

function partialObservation(observedAt: string): HealthObservation {
  return {
    observedAt,
    overall: "partial",
    live: {
      ok: true,
      endpoint: "live",
      httpStatus: 200,
      payload: { status: "live" }
    },
    ready: {
      ok: false,
      endpoint: "ready",
      httpStatus: 200,
      error: {
        code: "invalid_payload",
        message: "The health response did not match the expected public contract."
      }
    }
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
