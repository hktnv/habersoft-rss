import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOperationsDrilldown,
  type FeedDrilldownRow,
  type IngestionDrilldownRow,
  type OperationsDrilldown as OperationsDrilldownData,
  type OperationsDrilldownResult
} from "./operationsDrilldownClient";
import { requestFeedRecheck, type FeedRecheckResult } from "./feedRecheckClient";

type DrilldownPhase = "loading" | "refreshing" | "complete";
type FeedRecheckPhase = "confirming" | "submitting" | "complete";

type DrilldownState = {
  readonly phase: DrilldownPhase;
  readonly result?: OperationsDrilldownResult;
};

type FeedRecheckState = {
  readonly phase: FeedRecheckPhase;
  readonly result?: FeedRecheckResult;
};

export function OperationsDrilldown({
  loadDrilldown = fetchOperationsDrilldown,
  csrfToken,
  requestRecheck = requestFeedRecheck
}: {
  readonly loadDrilldown?: (options?: { readonly signal?: AbortSignal }) => Promise<OperationsDrilldownResult>;
  readonly csrfToken?: string;
  readonly requestRecheck?: (options: { readonly actionRef: string; readonly csrfToken: string; readonly signal?: AbortSignal }) => Promise<FeedRecheckResult>;
}) {
  const [state, setState] = useState<DrilldownState>({ phase: "loading" });
  const [feedRechecks, setFeedRechecks] = useState<Record<string, FeedRecheckState>>({});
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const actionAbortRef = useRef<AbortController | undefined>(undefined);
  const isBusy = state.phase === "loading" || state.phase === "refreshing";
  const hasCompletedResult = state.result !== undefined;

  const runRequest = useCallback(
    (requestId: number, controller: AbortController) => {
      void loadDrilldown({ signal: controller.signal }).then((result) => {
        if (requestIdRef.current !== requestId) return;
        setState({ phase: "complete", result });
        abortRef.current = undefined;
      });
    },
    [loadDrilldown]
  );

  const startRequest = useCallback(
    (phase: DrilldownPhase) => {
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
      actionAbortRef.current?.abort();
    };
  }, [runRequest]);

  const refresh = () => {
    if (isBusy) return;
    startRequest(hasCompletedResult ? "refreshing" : "loading");
  };

  const beginRecheckConfirmation = (row: FeedDrilldownRow) => {
    setFeedRechecks((current) => ({
      ...current,
      [row.displayId]: {
        phase: "confirming"
      }
    }));
  };

  const cancelRecheckConfirmation = (row: FeedDrilldownRow) => {
    setFeedRechecks((current) => {
      const next = { ...current };
      delete next[row.displayId];
      return next;
    });
  };

  const confirmRecheck = (row: FeedDrilldownRow) => {
    if (!row.canRequestRecheck || row.actionRef === null || csrfToken === undefined) {
      setFeedRechecks((current) => ({
        ...current,
        [row.displayId]: {
          phase: "complete",
          result: {
            kind: csrfToken === undefined ? "unauthenticated" : "invalid_response",
            message: csrfToken === undefined
              ? "Admin session expired. Sign in again before requesting a feed recheck."
              : "Feed recheck target is not eligible."
          }
        }
      }));
      return;
    }

    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    setFeedRechecks((current) => ({
      ...current,
      [row.displayId]: {
        phase: "submitting"
      }
    }));

    void requestRecheck({ actionRef: row.actionRef, csrfToken, signal: controller.signal }).then((result) => {
      setFeedRechecks((current) => ({
        ...current,
        [row.displayId]: {
          phase: "complete",
          result
        }
      }));
      actionAbortRef.current = undefined;
    });
  };

  return (
    <section className="operations-drilldown" aria-labelledby="operations-drilldown-title">
      <div className="dashboard-toolbar drilldown-toolbar">
        <div>
          <h2 id="operations-drilldown-title">Operations Drilldown</h2>
          <p>Bounded recent feed and ingestion signals for the authenticated admin session.</p>
        </div>
        <button type="button" onClick={refresh} disabled={isBusy} aria-busy={isBusy}>
          {isBusy ? "Refreshing..." : "Refresh Drilldown"}
        </button>
      </div>

      {state.result === undefined ? (
        <div className="status-summary" role="status" aria-live="polite">
          <p className="summary-value">Loading drilldown</p>
          <p className="safe-message">Checking the protected same-origin drilldown route.</p>
        </div>
      ) : state.result.kind === "success" ? (
        <DrilldownView
          drilldown={state.result.drilldown}
          refreshing={state.phase === "refreshing"}
          feedRechecks={feedRechecks}
          onBeginRecheckConfirmation={beginRecheckConfirmation}
          onCancelRecheckConfirmation={cancelRecheckConfirmation}
          onConfirmRecheck={confirmRecheck}
        />
      ) : (
        <DrilldownUnavailableView result={state.result} />
      )}
    </section>
  );
}

function DrilldownView({
  drilldown,
  refreshing,
  feedRechecks,
  onBeginRecheckConfirmation,
  onCancelRecheckConfirmation,
  onConfirmRecheck
}: {
  readonly drilldown: OperationsDrilldownData;
  readonly refreshing: boolean;
  readonly feedRechecks: Readonly<Record<string, FeedRecheckState>>;
  readonly onBeginRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onCancelRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onConfirmRecheck: (row: FeedDrilldownRow) => void;
}) {
  const emptyRows = drilldown.feeds.rows.length === 0 && drilldown.ingestion.rows.length === 0;
  const hasRecheckableFeed = drilldown.feeds.rows.some((row) => row.canRequestRecheck);
  const stateClass = drilldown.status === "ok" ? "state-healthy" : drilldown.status === "partial" ? "state-partial" : "state-unavailable";

  return (
    <>
      <section className="status-summary" aria-live="polite" role="status">
        <div className="summary-row">
          <div>
            <p className="summary-label">Drilldown</p>
            <p className={`summary-value ${stateClass}`}>{drilldown.status}</p>
          </div>
          <div>
            <p className="summary-label">Generated</p>
            <time className="summary-value" dateTime={drilldown.generatedAt}>
              {drilldown.generatedAt}
            </time>
          </div>
          <p className="safe-message">
            {refreshing ? "Refreshing; the last validated drilldown remains visible until the next result arrives. " : ""}
            Same-origin protected route: /admin-api/operations/drilldown.
          </p>
        </div>
      </section>

      {emptyRows ? (
        <section className="status-summary" role="status" aria-live="polite">
          <p className="summary-value">No recheckable feeds are currently available.</p>
          <p className="safe-message">
            The bounded window returned no feed action targets. Feed recheck effect acceptance remains pending until an
            eligible feed exists.
          </p>
        </section>
      ) : (
        <section className="panel-grid drilldown-grid" aria-label="Operations drilldown rows">
          <FeedDrilldownPanel
            drilldown={drilldown}
            hasRecheckableFeed={hasRecheckableFeed}
            feedRechecks={feedRechecks}
            onBeginRecheckConfirmation={onBeginRecheckConfirmation}
            onCancelRecheckConfirmation={onCancelRecheckConfirmation}
            onConfirmRecheck={onConfirmRecheck}
          />
          <IngestionDrilldownPanel drilldown={drilldown} />
          <article className="panel notes-panel drilldown-notes">
            <h2>Drilldown Notes</h2>
            <ul>
              {drilldown.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {drilldown.capabilities.reason !== null ? <li>{drilldown.capabilities.reason}</li> : null}
            </ul>
          </article>
        </section>
      )}
    </>
  );
}

function FeedDrilldownPanel({
  drilldown,
  hasRecheckableFeed,
  feedRechecks,
  onBeginRecheckConfirmation,
  onCancelRecheckConfirmation,
  onConfirmRecheck
}: {
  readonly drilldown: OperationsDrilldownData;
  readonly hasRecheckableFeed: boolean;
  readonly feedRechecks: Readonly<Record<string, FeedRecheckState>>;
  readonly onBeginRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onCancelRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onConfirmRecheck: (row: FeedDrilldownRow) => void;
}) {
  return (
    <article className="panel drilldown-panel">
      <h2>Feed Signals</h2>
      <MetricStrip
        metrics={[
          ["Total", drilldown.feeds.total],
          ["Active", drilldown.feeds.active],
          ["Due", drilldown.feeds.due],
          ["Recent success", drilldown.feeds.withRecentSuccess],
          ["Recent failure", drilldown.feeds.withRecentFailure]
        ]}
      />
      {hasRecheckableFeed ? null : (
        <p className="safe-message">No recheckable feeds are currently available.</p>
      )}
      <FeedRows
        rows={drilldown.feeds.rows}
        feedRechecks={feedRechecks}
        onBeginRecheckConfirmation={onBeginRecheckConfirmation}
        onCancelRecheckConfirmation={onCancelRecheckConfirmation}
        onConfirmRecheck={onConfirmRecheck}
      />
    </article>
  );
}

function IngestionDrilldownPanel({ drilldown }: { readonly drilldown: OperationsDrilldownData }) {
  return (
    <article className="panel drilldown-panel">
      <h2>Ingestion Signals</h2>
      <MetricStrip
        metrics={[
          ["Recent entries", drilldown.ingestion.recentEntryCount],
          ["Recent checks", drilldown.ingestion.recentBatchCount],
          ["Latest entry", drilldown.ingestion.latestEntryAt]
        ]}
      />
      <IngestionRows rows={drilldown.ingestion.rows} />
    </article>
  );
}

function MetricStrip({ metrics }: { readonly metrics: readonly (readonly [string, number | string | null])[] }) {
  return (
    <dl className="drilldown-metrics">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "Unavailable"}</dd>
        </div>
      ))}
    </dl>
  );
}

function FeedRows({
  rows,
  feedRechecks,
  onBeginRecheckConfirmation,
  onCancelRecheckConfirmation,
  onConfirmRecheck
}: {
  readonly rows: readonly FeedDrilldownRow[];
  readonly feedRechecks: Readonly<Record<string, FeedRecheckState>>;
  readonly onBeginRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onCancelRecheckConfirmation: (row: FeedDrilldownRow) => void;
  readonly onConfirmRecheck: (row: FeedDrilldownRow) => void;
}) {
  if (rows.length === 0) return <p className="safe-message">No feed rows in this bounded window.</p>;

  return (
    <div className="drilldown-table-wrap">
      <table className="drilldown-table">
        <thead>
          <tr>
            <th scope="col">Feed</th>
            <th scope="col">Source</th>
            <th scope="col">Health</th>
            <th scope="col">Last check</th>
            <th scope="col">Entries</th>
            <th scope="col">Notes</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.displayId}>
              <td>
                <strong>{row.displayName ?? row.displayId}</strong>
                {row.displayName === null ? null : <span>{row.displayId}</span>}
              </td>
              <td>{row.sourceHost ?? "Redacted"}</td>
              <td className={`state-${row.health === "healthy" ? "healthy" : row.health === "degraded" ? "degraded" : "partial"}`}>
                {row.health}
              </td>
              <td>
                <span>{row.lastResult}</span>
                <span>{row.lastCheckedAt ?? "Unavailable"}</span>
              </td>
              <td>{row.recentEntryCount ?? "Unavailable"}</td>
              <td>{row.notes.length === 0 ? "None" : row.notes.join(" ")}</td>
              <td>
                <FeedRecheckControls
                  row={row}
                  state={feedRechecks[row.displayId]}
                  onBegin={() => onBeginRecheckConfirmation(row)}
                  onCancel={() => onCancelRecheckConfirmation(row)}
                  onConfirm={() => onConfirmRecheck(row)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FeedRecheckControls({
  row,
  state,
  onBegin,
  onCancel,
  onConfirm
}: {
  readonly row: FeedDrilldownRow;
  readonly state?: FeedRecheckState;
  readonly onBegin: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!row.canRequestRecheck) {
    return <span className="action-note">{describeUnavailableReason(row.recheckUnavailableReason)}</span>;
  }

  if (state?.phase === "confirming") {
    return (
      <div className="feed-action-stack">
        <span className="action-note">Request a safe recheck for this feed?</span>
        <button type="button" className="compact-button" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className="secondary-button compact-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (state?.phase === "submitting") {
    return (
      <button type="button" className="compact-button" disabled aria-busy="true">
        Requesting...
      </button>
    );
  }

  if (state?.phase === "complete" && state.result !== undefined) {
    return (
      <div className="feed-action-stack" role="status" aria-live="polite">
        <span className={`action-note state-${resultTone(state.result)}`}>{describeRecheckResult(state.result)}</span>
        {state.result.kind === "accepted" || state.result.kind === "already_pending" || state.result.kind === "rate_limited" ? null : (
          <button type="button" className="compact-button" onClick={onBegin}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <button type="button" className="compact-button" onClick={onBegin}>
      Request recheck
    </button>
  );
}

function describeUnavailableReason(reason: FeedDrilldownRow["recheckUnavailableReason"]): string {
  switch (reason) {
    case "inactive_feed":
      return "Inactive";
    case "no_subscribers":
      return "No subscribers";
    case "source_host_redacted":
      return "Source redacted";
    case "admin_auth_not_configured":
      return "Auth unavailable";
    case null:
      return "Unavailable";
  }
}

function describeRecheckResult(result: FeedRecheckResult): string {
  switch (result.kind) {
    case "accepted":
    case "already_pending":
    case "rate_limited":
    case "unavailable":
    case "not_found":
      return result.response.message;
    case "unauthenticated":
    case "forbidden":
    case "invalid_response":
    case "timeout":
      return result.message;
  }
}

function resultTone(result: FeedRecheckResult): "healthy" | "partial" | "degraded" | "unavailable" {
  switch (result.kind) {
    case "accepted":
    case "already_pending":
      return "healthy";
    case "rate_limited":
      return "partial";
    case "unauthenticated":
    case "forbidden":
      return "degraded";
    case "unavailable":
    case "not_found":
    case "invalid_response":
    case "timeout":
      return "unavailable";
  }
}

function IngestionRows({ rows }: { readonly rows: readonly IngestionDrilldownRow[] }) {
  if (rows.length === 0) return <p className="safe-message">No ingestion rows in this bounded window.</p>;

  return (
    <div className="drilldown-table-wrap">
      <table className="drilldown-table">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col">Feed</th>
            <th scope="col">Received</th>
            <th scope="col">Entries</th>
            <th scope="col">Status</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.displayId}>
              <td>{row.displayId}</td>
              <td>{row.feedDisplayId ?? "Unavailable"}</td>
              <td>{row.receivedAt ?? "Unavailable"}</td>
              <td>{row.entryCount ?? "Unavailable"}</td>
              <td className={`state-${row.status === "accepted" ? "healthy" : row.status === "skipped" ? "partial" : "unavailable"}`}>
                {row.status}
              </td>
              <td>{row.notes.length === 0 ? "None" : row.notes.join(" ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrilldownUnavailableView({
  result
}: {
  readonly result: Exclude<OperationsDrilldownResult, { readonly kind: "success" }>;
}) {
  const message =
    result.kind === "unauthenticated"
      ? "The admin session expired or is missing. Sign in again before refreshing the operations drilldown."
      : result.message;

  return (
    <section className="status-summary" role="status" aria-live="polite">
      <div className="summary-row">
        <div>
          <p className="summary-label">Drilldown API</p>
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
