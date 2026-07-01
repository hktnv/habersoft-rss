import { useState, type FormEvent } from "react";
import { requestFeedOnboarding, type FeedOnboardingResult } from "./feedOnboardingClient";

type FeedOnboardingPhase = "idle" | "submitting" | "complete";

export type FeedOnboardingPanelProps = {
  readonly csrfToken?: string;
  readonly requestOnboarding?: (options: { readonly feedUrl: string; readonly label?: string; readonly csrfToken: string; readonly signal?: AbortSignal }) => Promise<FeedOnboardingResult>;
  readonly onAccepted?: () => void;
  readonly onResult?: (result: FeedOnboardingResult) => void;
};

export function FeedOnboardingPanel({
  csrfToken,
  requestOnboarding = requestFeedOnboarding,
  onAccepted,
  onResult
}: FeedOnboardingPanelProps) {
  const [feedUrl, setFeedUrl] = useState("");
  const [label, setLabel] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<FeedOnboardingPhase>("idle");
  const [result, setResult] = useState<FeedOnboardingResult | undefined>(undefined);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase === "submitting") return;
    if (csrfToken === undefined) {
      setPhase("complete");
      setResult({
        kind: "unauthenticated",
        message: "Admin session expired. Sign in again before onboarding a feed."
      });
      return;
    }
    if (!confirmed) {
      setPhase("complete");
      setResult({
        kind: "invalid_request",
        message: "Confirm the real feed onboarding action before submitting."
      });
      return;
    }

    const controller = new AbortController();
    setPhase("submitting");
    setResult(undefined);
    void requestOnboarding({
      feedUrl,
      label,
      csrfToken,
      signal: controller.signal
    }).then((nextResult) => {
      setPhase("complete");
      setResult(nextResult);
      onResult?.(nextResult);
      if (nextResult.kind === "created" || nextResult.kind === "already_exists") {
        setFeedUrl("");
        setLabel("");
        setConfirmed(false);
        onAccepted?.();
      }
    });
  };

  const busy = phase === "submitting";

  return (
    <article className="panel feed-onboarding-panel" aria-labelledby="feed-onboarding-title">
      <div className="feed-onboarding-copy">
        <h2 id="feed-onboarding-title">Feed Onboarding</h2>
        <p className="safe-message">Feed recheck effect acceptance is pending until a real eligible feed exists.</p>
      </div>
      <form className="feed-onboarding-form" onSubmit={submit}>
        <label htmlFor="feed-onboarding-url">Feed URL</label>
        <input
          id="feed-onboarding-url"
          name="feedUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={feedUrl}
          onChange={(event) => setFeedUrl(event.target.value)}
          placeholder="https://example.com/feed.xml"
          maxLength={2048}
          required
          disabled={busy}
        />
        <label htmlFor="feed-onboarding-label">Label</label>
        <input
          id="feed-onboarding-label"
          name="label"
          type="text"
          autoComplete="off"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          disabled={busy}
        />
        <label className="confirmation-check" htmlFor="feed-onboarding-confirm">
          <input
            id="feed-onboarding-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={busy}
          />
          <span>This creates a real feed target after operator deployment.</span>
        </label>
        <button type="submit" disabled={busy || csrfToken === undefined} aria-busy={busy}>
          {busy ? "Submitting..." : "Onboard feed"}
        </button>
      </form>
      {result === undefined ? null : <FeedOnboardingResultView result={result} />}
    </article>
  );
}

function FeedOnboardingResultView({ result }: { readonly result: FeedOnboardingResult }) {
  if (isResponseResult(result)) {
    return (
      <div className="feed-onboarding-result" role="status" aria-live="polite">
        <p className={`action-note state-${resultTone(result)}`}>{result.response.message}</p>
        {result.response.feed === null ? null : (
          <dl className="onboarding-result-list">
            <div>
              <dt>Feed</dt>
              <dd>{result.response.feed.displayId}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{result.response.feed.sourceHost}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{result.response.feed.state}</dd>
            </div>
            <div>
              <dt>Eligible</dt>
              <dd>{result.response.feed.eligibleForRecheck ? "yes" : "no"}</dd>
            </div>
          </dl>
        )}
      </div>
    );
  }

  return (
    <p className={`action-note state-${result.kind === "invalid_request" ? "degraded" : "unavailable"}`} role="status" aria-live="polite">
      {result.message}
    </p>
  );
}

function isResponseResult(result: FeedOnboardingResult): result is Extract<FeedOnboardingResult, { readonly response: unknown }> {
  return "response" in result;
}

function resultTone(result: Extract<FeedOnboardingResult, { readonly response: unknown }>): "healthy" | "partial" | "unavailable" {
  if (result.kind === "created" || result.kind === "already_exists") return "healthy";
  if (result.kind === "rate_limited") return "partial";
  return "unavailable";
}
