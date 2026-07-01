import type { FeedRecheckResult } from "./feedRecheckClient";
import type { OperationsDrilldown } from "./operationsDrilldownClient";

export const REDACTED_BROWSER_EVIDENCE_SCHEMA = "habersoft-admin-browser-evidence-v1" as const;
export const redactedBrowserEvidenceMaxBytes = 32768;

export type BrowserEvidenceClassification =
  | "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY"
  | "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
  | "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
  | "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
  | "BROWSER_EVIDENCE_INVALID";

export type FeedRecheckEvidenceStatus =
  | "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET"
  | "PENDING_OPERATOR_ACTION"
  | "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED";

export type RedactedBrowserEvidence = {
  readonly schema: typeof REDACTED_BROWSER_EVIDENCE_SCHEMA;
  readonly source: "admin-ui";
  readonly milestone: "MS-026C";
  readonly generatedAt: string;
  readonly authenticated: true;
  readonly operations: {
    readonly drilldownStatus: OperationsDrilldown["status"];
    readonly drilldownGeneratedAt: string;
    readonly feeds: {
      readonly total: number | null;
      readonly active: number | null;
      readonly rows: number;
      readonly eligibleRecheckTargets: number;
      readonly noEligibleFeedRecheckTarget: boolean;
    };
    readonly ingestion: {
      readonly rows: number;
      readonly recentEntryCount: number | null;
      readonly recentBatchCount: number | null;
    };
  };
  readonly feedRecheck: {
    readonly effectStatus: FeedRecheckEvidenceStatus;
    readonly lastActionClassification:
      | "FEED_RECHECK_ACTION_ACCEPTED"
      | "FEED_RECHECK_ACTION_ALREADY_PENDING"
      | "FEED_RECHECK_ACTION_RATE_LIMITED"
      | null;
  };
  readonly classifications: readonly BrowserEvidenceClassification[];
};

export type BrowserEvidenceValidationResult =
  | {
      readonly valid: true;
      readonly evidence: RedactedBrowserEvidence;
      readonly classifications: readonly BrowserEvidenceClassification[];
    }
  | {
      readonly valid: false;
      readonly classification: "BROWSER_EVIDENCE_INVALID";
      readonly reason:
        | "invalid_json"
        | "not_object"
        | "overlarge"
        | "unknown_field"
        | "forbidden_field"
        | "forbidden_value"
        | "invalid_schema";
    };

export function createRedactedBrowserEvidence(
  drilldown: OperationsDrilldown,
  feedRechecks: Readonly<Record<string, { readonly result?: FeedRecheckResult }>> = {}
): RedactedBrowserEvidence {
  const eligibleRecheckTargets = drilldown.feeds.rows.filter((row) => row.canRequestRecheck && row.actionRef !== null).length;
  const lastActionClassification = latestSafeActionClassification(feedRechecks);
  const acceptedEffect = lastActionClassification === "FEED_RECHECK_ACTION_ACCEPTED" || lastActionClassification === "FEED_RECHECK_ACTION_ALREADY_PENDING";
  const noEligible = eligibleRecheckTargets === 0;
  const effectStatus: FeedRecheckEvidenceStatus = noEligible
    ? "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET"
    : acceptedEffect
      ? "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
      : "PENDING_OPERATOR_ACTION";
  const classifications: BrowserEvidenceClassification[] = ["BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY"];
  if (noEligible) {
    classifications.push("BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET");
  } else if (acceptedEffect) {
    classifications.push("BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED");
  } else {
    classifications.push("BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET");
  }

  return {
    schema: REDACTED_BROWSER_EVIDENCE_SCHEMA,
    source: "admin-ui",
    milestone: "MS-026C",
    generatedAt: new Date().toISOString(),
    authenticated: true,
    operations: {
      drilldownStatus: drilldown.status,
      drilldownGeneratedAt: drilldown.generatedAt,
      feeds: {
        total: drilldown.feeds.total,
        active: drilldown.feeds.active,
        rows: drilldown.feeds.rows.length,
        eligibleRecheckTargets,
        noEligibleFeedRecheckTarget: noEligible
      },
      ingestion: {
        rows: drilldown.ingestion.rows.length,
        recentEntryCount: drilldown.ingestion.recentEntryCount,
        recentBatchCount: drilldown.ingestion.recentBatchCount
      }
    },
    feedRecheck: {
      effectStatus,
      lastActionClassification
    },
    classifications
  };
}

export function serializeRedactedBrowserEvidence(evidence: RedactedBrowserEvidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function validateRedactedBrowserEvidenceText(text: string): BrowserEvidenceValidationResult {
  if (new TextEncoder().encode(text).length > redactedBrowserEvidenceMaxBytes) {
    return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "overlarge" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "invalid_json" };
  }

  return validateRedactedBrowserEvidence(parsed);
}

export function validateRedactedBrowserEvidence(value: unknown): BrowserEvidenceValidationResult {
  if (!isRecord(value)) return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "not_object" };
  const forbidden = findForbiddenEvidenceSurface(value);
  if (forbidden === "field") return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "forbidden_field" };
  if (forbidden === "value") return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "forbidden_value" };
  if (!hasOnlyKeys(value, ["schema", "source", "milestone", "generatedAt", "authenticated", "operations", "feedRecheck", "classifications"])) {
    return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "unknown_field" };
  }
  if (
    value.schema !== REDACTED_BROWSER_EVIDENCE_SCHEMA ||
    value.source !== "admin-ui" ||
    value.milestone !== "MS-026C" ||
    value.authenticated !== true ||
    !isIso(value.generatedAt) ||
    !isOperationsEvidence(value.operations) ||
    !isFeedRecheckEvidence(value.feedRecheck) ||
    !isClassifications(value.classifications)
  ) {
    return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "invalid_schema" };
  }

  return {
    valid: true,
    evidence: value as RedactedBrowserEvidence,
    classifications: value.classifications as readonly BrowserEvidenceClassification[]
  };
}

function latestSafeActionClassification(feedRechecks: Readonly<Record<string, { readonly result?: FeedRecheckResult }>>): RedactedBrowserEvidence["feedRecheck"]["lastActionClassification"] {
  for (const state of Object.values(feedRechecks)) {
    switch (state.result?.kind) {
      case "accepted":
        return "FEED_RECHECK_ACTION_ACCEPTED";
      case "already_pending":
        return "FEED_RECHECK_ACTION_ALREADY_PENDING";
      case "rate_limited":
        return "FEED_RECHECK_ACTION_RATE_LIMITED";
      case "forbidden":
      case "invalid_response":
      case "not_found":
      case "timeout":
      case "unauthenticated":
      case "unavailable":
      case undefined:
        break;
    }
  }
  return null;
}

function isOperationsEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["drilldownStatus", "drilldownGeneratedAt", "feeds", "ingestion"])) return false;
  return isDrilldownStatus(value.drilldownStatus) && isIso(value.drilldownGeneratedAt) && isFeedsEvidence(value.feeds) && isIngestionEvidence(value.ingestion);
}

function isFeedsEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["total", "active", "rows", "eligibleRecheckTargets", "noEligibleFeedRecheckTarget"])) return false;
  return (
    isNullableCount(value.total) &&
    isNullableCount(value.active) &&
    isCount(value.rows) &&
    isCount(value.eligibleRecheckTargets) &&
    typeof value.noEligibleFeedRecheckTarget === "boolean"
  );
}

function isIngestionEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["rows", "recentEntryCount", "recentBatchCount"])) return false;
  return isCount(value.rows) && isNullableCount(value.recentEntryCount) && isNullableCount(value.recentBatchCount);
}

function isFeedRecheckEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["effectStatus", "lastActionClassification"])) return false;
  return (
    (value.effectStatus === "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET" ||
      value.effectStatus === "PENDING_OPERATOR_ACTION" ||
      value.effectStatus === "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED") &&
    (value.lastActionClassification === null ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_ACCEPTED" ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_ALREADY_PENDING" ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_RATE_LIMITED")
  );
}

function isClassifications(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const allowed = new Set<BrowserEvidenceClassification>([
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
    "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
  ]);
  return value.every((classification) => typeof classification === "string" && allowed.has(classification as BrowserEvidenceClassification));
}

function findForbiddenEvidenceSurface(value: unknown): "field" | "value" | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findForbiddenEvidenceSurface(item);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && forbiddenStringPattern.test(value)) return "value";
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) return "field";
    const result = findForbiddenEvidenceSurface(nested);
    if (result !== undefined) return result;
  }
  return undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isDrilldownStatus(value: unknown): boolean {
  return value === "ok" || value === "partial" || value === "unavailable";
}

function isCount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
}

function isNullableCount(value: unknown): boolean {
  return value === null || isCount(value);
}

function isIso(value: unknown): boolean {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const forbiddenKeyPattern = /(?:cookie|session|csrf|idempotency|actionref|action_ref|secret|password|token|authorization|bearer|raw|url|href|host|hostname|path|stack|filesystem|storage)/iu;
const forbiddenStringPattern = /feed_recheck_v1\.|https?:\/\/|Set-Cookie|Authorization|Bearer\s+|csrf|idempotency|[A-Z]:\\|\/(?:home|var|etc|tmp)\//iu;
