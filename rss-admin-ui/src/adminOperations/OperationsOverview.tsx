import { useCallback, useEffect, useRef, useState } from "react";
import { OperationsDrilldown } from "./OperationsDrilldown";
import type { OperationsDrilldownResult } from "./operationsDrilldownClient";
import { fetchOperationsSummary, type OperationsSummary, type OperationsSummaryResult } from "./operationsSummaryClient";

type OverviewPhase = "loading" | "refreshing" | "complete";

type OverviewState = {
  readonly phase: OverviewPhase;
  readonly result?: OperationsSummaryResult;
};

const dependencyLabels: Record<keyof OperationsSummary["dependencies"], string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  tenantAuth: "Tenant auth"
};

export function OperationsOverview({
  loadSummary = fetchOperationsSummary,
  loadDrilldown,
  csrfToken
}: {
  readonly loadSummary?: (options?: { readonly signal?: AbortSignal }) => Promise<OperationsSummaryResult>;
  readonly loadDrilldown?: (options?: { readonly signal?: AbortSignal }) => Promise<OperationsDrilldownResult>;
  readonly csrfToken?: string;
}) {
  const [state, setState] = useState<OverviewState>({ phase: "loading" });
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const isBusy = state.phase === "loading" || state.phase === "refreshing";
  const hasCompletedResult = state.result !== undefined;

  const runRequest = useCallback(
    (requestId: number, controller: AbortController) => {
      void loadSummary({ signal: controller.signal }).then((result) => {
        if (requestIdRef.current !== requestId) return;
        setState({ phase: "complete", result });
        abortRef.current = undefined;
      });
    },
    [loadSummary]
  );

  const startRequest = useCallback(
    (phase: OverviewPhase) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      setState((current) => ({
        phase,
        result: phase === "refreshing" ? current.result : undefined
      }));
      runRequest(requestId, controller);
    },
    [runRequest]
  );

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    runRequest(requestId, controller);
    return () => {
      abortRef.current?.abort();
    };
  }, [runRequest]);

  const refresh = () => {
    if (isBusy) return;
    startRequest(hasCompletedResult ? "refreshing" : "loading");
  };

  return (
    <section className="operations-overview" aria-labelledby="operations-overview-title">
      <div className="workspace-band operations-band">
        <div>
          <p className="eyebrow">Read-only admin operations</p>
          <h1 id="operations-overview-title">Operations Overview</h1>
          <p className="lede">
            Protected aggregate view of backend readiness, feed volume, entry volume, and ingestion activity. This
            panel never renders raw feed content, tenant identifiers, Agent keys, or write controls.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={isBusy} aria-busy={isBusy}>
          {isBusy ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {state.result === undefined ? (
        <div className="status-summary" role="status" aria-live="polite">
          <p className="summary-value">Loading</p>
          <p className="safe-message">Checking the protected same-origin admin operations API.</p>
        </div>
      ) : state.result.kind === "success" ? (
        <SummaryView summary={state.result.summary} refreshing={state.phase === "refreshing"} />
      ) : (
        <UnavailableView result={state.result} />
      )}

      <OperationsDrilldown loadDrilldown={loadDrilldown} csrfToken={csrfToken} />
    </section>
  );
}

function SummaryView({
  summary,
  refreshing
}: {
  readonly summary: OperationsSummary;
  readonly refreshing: boolean;
}) {
  return (
    <>
      <section className="status-summary" aria-live="polite" role="status">
        <div className="summary-row">
          <div>
            <p className="summary-label">Generated</p>
            <time className="summary-value" dateTime={summary.generatedAt}>
              {summary.generatedAt}
            </time>
          </div>
          <div>
            <p className="summary-label">Window</p>
            <p className="summary-value">{summary.window.recentHours} hours</p>
          </div>
          <p className="safe-message">
            {refreshing ? "Refreshing; the last validated summary remains visible until the next result arrives. " : ""}
            Same-origin protected route: /admin-api/operations/summary.
          </p>
        </div>
      </section>

      <section className="panel-grid operations-grid" aria-label="Operations aggregate metrics">
        <DependencyCard dependencies={summary.dependencies} />
        <MetricCard
          title="Feeds"
          metrics={[
            ["Total", summary.feeds.total],
            ["Active", summary.feeds.active],
            ["Disabled", summary.feeds.disabled],
            ["Due now", summary.feeds.dueNow]
          ]}
        />
        <MetricCard
          title="Entries"
          metrics={[
            ["Total", summary.entries.total],
            ["Created last 24h", summary.entries.createdLast24h]
          ]}
        />
        <MetricCard
          title="Ingestion"
          metrics={[
            ["Checks last 24h", summary.ingestion.checksLast24h],
            ["Succeeded last 24h", summary.ingestion.successLast24h],
            ["Failed last 24h", summary.ingestion.failedLast24h],
            ["Latest check", summary.ingestion.latestCheckAt]
          ]}
        />
        <article className="panel notes-panel">
          <h2>Operator Notes</h2>
          <ul>
            {summary.notes.map((note) => (
              <li key={note.code}>
                <strong>{note.code}</strong>: {note.message}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </>
  );
}

function DependencyCard({
  dependencies
}: {
  readonly dependencies: OperationsSummary["dependencies"];
}) {
  return (
    <article className="panel">
      <h2>Backend Dependencies</h2>
      <dl className="dependency-list" aria-label="Operations dependency states">
        {Object.entries(dependencies).map(([key, value]) => (
          <div key={key}>
            <dt>{dependencyLabels[key as keyof OperationsSummary["dependencies"]]}</dt>
            <dd className={value === "up" ? "state-healthy" : value === "down" ? "state-unavailable" : "state-partial"}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function MetricCard({
  title,
  metrics
}: {
  readonly title: string;
  readonly metrics: readonly (readonly [string, number | string | null])[];
}) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      <dl className="dependency-list">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "Unavailable"}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function UnavailableView({ result }: { readonly result: Exclude<OperationsSummaryResult, { readonly kind: "success" }> }) {
  const message =
    result.kind === "unauthenticated"
      ? "The admin session expired or is missing. Sign in again before refreshing the operations overview."
      : result.message;

  return (
    <section className="status-summary" role="status" aria-live="polite">
      <div className="summary-row">
        <div>
          <p className="summary-label">Operations API</p>
          <p className={`summary-value state-${result.kind === "unauthenticated" ? "degraded" : "unavailable"}`}>
            {result.kind}
          </p>
        </div>
        <div>
          <p className="summary-label">HTTP</p>
          <p className="summary-value">{result.httpStatus ?? "none"}</p>
        </div>
        <p className="safe-message">
          {message} If this follows a backend recreate or network change, run the frontend canonical helper recreate
          before retesting.
        </p>
      </div>
    </section>
  );
}
