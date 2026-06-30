import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminUiConfig } from "../config/adminUiConfig";
import { resolveAdminUiConfig } from "../config/adminUiConfig";
import type {
  HealthEndpointObservation,
  HealthObservation,
  ObservedHealthState,
  ObserveBackendHealthOptions,
  ReadyHealthPayload
} from "./healthClient";
import { observeBackendHealth } from "./healthClient";

type ObserveHealth = (
  options?: ObserveBackendHealthOptions
) => Promise<HealthObservation>;

type DashboardPhase = "unknown" | "loading" | "refreshing" | "complete";

type DashboardState = {
  readonly phase: DashboardPhase;
  readonly observation?: HealthObservation;
};

type StatusDashboardProps = {
  readonly config?: AdminUiConfig;
  readonly observeHealth?: ObserveHealth;
};

const dependencyLabels: Record<keyof ReadyHealthPayload["dependencies"], string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  tenantAuth: "Tenant auth"
};

const overallLabels: Record<ObservedHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unavailable: "Unavailable",
  partial: "Partial"
};

const overallMessages: Record<ObservedHealthState, string> = {
  healthy: "Live and ready responses match the public health contract.",
  degraded: "Liveness is established, but readiness or a dependency is not up.",
  unavailable: "Liveness could not be safely established.",
  partial: "Liveness was observed, but the full readiness contract could not be validated."
};

export function StatusDashboard({
  config = resolveAdminUiConfig(),
  observeHealth = observeBackendHealth
}: StatusDashboardProps) {
  const [state, setState] = useState<DashboardState>({ phase: "loading" });
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const hasCompletedObservation = state.observation !== undefined;
  const isBusy = state.phase === "loading" || state.phase === "refreshing";

  const startObservationRequest = useCallback(
    () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      void observeHealth({ signal: controller.signal }).then((observation) => {
        if (requestIdRef.current !== requestId) return;
        setState({ phase: "complete", observation });
      });
    },
    [observeHealth]
  );

  const runObservation = useCallback(
    (phase: "loading" | "refreshing") => {
      setState((current) => ({
        phase,
        observation: phase === "refreshing" ? current.observation : undefined
      }));
      startObservationRequest();
    },
    [startObservationRequest]
  );

  useEffect(() => {
    startObservationRequest();
    return () => {
      abortRef.current?.abort();
    };
  }, [startObservationRequest]);

  const refresh = () => {
    if (isBusy) return;
    runObservation(hasCompletedObservation ? "refreshing" : "loading");
  };

  return (
    <main className="app-shell" aria-labelledby="page-title">
      <section className="workspace-band status-band">
        <div>
          <p className="eyebrow">Habersoft RSS</p>
          <h1 id="page-title">Read-only Status Dashboard</h1>
          <p className="lede">
            Current browser observation of the same-origin public health surface. This view does not perform
            authenticated admin actions or production evidence collection.
          </p>
        </div>
        <dl className="status-grid" aria-label="Dashboard status">
          <div>
            <dt>UI status</dt>
            <dd>READ_ONLY_STATUS_DASHBOARD_PRODUCTION_TRANSPORT_ACTIVE</dd>
          </div>
          <div>
            <dt>Auth shell</dt>
            <dd>AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED</dd>
          </div>
          <div>
            <dt>API writes</dt>
            <dd>OUT_OF_SCOPE</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-toolbar" aria-label="Observation controls">
        <div>
          <h2>Configured Observation</h2>
          <p>
            Environment label: <strong>{config.environmentName}</strong> <span>(configuration label only)</span>
          </p>
          <p>Source: same-origin public health status routes</p>
        </div>
        <button type="button" onClick={refresh} disabled={isBusy} aria-busy={isBusy}>
          {isBusy ? "Checking..." : "Refresh"}
        </button>
      </section>

      <section className="status-summary" aria-labelledby="observed-state-title" aria-live="polite" role="status">
        <h2 id="observed-state-title">Observed State</h2>
        {state.observation === undefined ? (
          <EmptyObservation phase={state.phase} />
        ) : (
          <ObservationSummary observation={state.observation} isRefreshing={state.phase === "refreshing"} />
        )}
      </section>

      <section className="panel-grid" aria-label="Health details">
        <HealthPanel
          title="Liveness"
          observation={state.observation?.live}
          readyText={state.observation?.live.ok === true ? "live" : undefined}
        />
        <HealthPanel
          title="Readiness"
          observation={state.observation?.ready}
          readyText={state.observation?.ready.ok === true ? state.observation.ready.payload.status : undefined}
        />
        <DependencyPanel observation={state.observation?.ready} />
      </section>
    </main>
  );
}

function EmptyObservation({ phase }: { readonly phase: DashboardPhase }) {
  return (
    <div className="summary-row">
      <div>
        <p className="summary-label">Overall</p>
        <p className="summary-value">{phase === "loading" ? "Loading" : "Unknown"}</p>
      </div>
      <p className="safe-message">
        {phase === "loading"
          ? "Checking public health endpoints..."
          : "No completed browser observation is available yet."}
      </p>
    </div>
  );
}

function ObservationSummary({
  observation,
  isRefreshing
}: {
  readonly observation: HealthObservation;
  readonly isRefreshing: boolean;
}) {
  return (
    <div className="summary-row">
      <div>
        <p className="summary-label">Overall</p>
        <p className={`summary-value state-${observation.overall}`}>{overallLabels[observation.overall]}</p>
      </div>
      <div>
        <p className="summary-label">Last checked</p>
        <time className="summary-value" dateTime={observation.observedAt}>
          {observation.observedAt}
        </time>
      </div>
      <p className="safe-message">
        {isRefreshing ? "Refreshing; previous completed observation remains visible until the new check completes. " : ""}
        {overallMessages[observation.overall]}
      </p>
    </div>
  );
}

function HealthPanel<TPayload>({
  title,
  observation,
  readyText
}: {
  readonly title: string;
  readonly observation: HealthEndpointObservation<TPayload> | undefined;
  readonly readyText: string | undefined;
}) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      {observation === undefined ? (
        <p>Not observed yet.</p>
      ) : observation.ok ? (
        <>
          <p className="metric-value">{readyText}</p>
          <p>HTTP {observation.httpStatus}; response shape validated.</p>
        </>
      ) : (
        <>
          <p className="metric-value">Not established</p>
          <p>{observation.error.message}</p>
          {observation.httpStatus === undefined ? null : <p>HTTP {observation.httpStatus}</p>}
        </>
      )}
    </article>
  );
}

function DependencyPanel({
  observation
}: {
  readonly observation: HealthEndpointObservation<ReadyHealthPayload> | undefined;
}) {
  const dependencies = observation?.ok === true ? observation.payload.dependencies : undefined;

  return (
    <article className="panel">
      <h2>Readiness Dependencies</h2>
      {dependencies === undefined ? (
        <p>Dependency states are available only after a valid readiness response.</p>
      ) : (
        <dl className="dependency-list" aria-label="Readiness dependency states">
          {Object.entries(dependencies).map(([key, value]) => (
            <div key={key}>
              <dt>{dependencyLabels[key as keyof ReadyHealthPayload["dependencies"]]}</dt>
              <dd className={value === "up" ? "state-healthy" : "state-degraded"}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
