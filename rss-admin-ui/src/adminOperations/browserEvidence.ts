import type { FeedOnboardingResult } from "./feedOnboardingClient";
import type { FeedRecheckResult } from "./feedRecheckClient";
import type { OperationsDrilldown } from "./operationsDrilldownClient";

export const REDACTED_BROWSER_EVIDENCE_SCHEMA = "habersoft-admin-browser-evidence-v1" as const;
export const redactedBrowserEvidenceMaxBytes = 32768;

export type BrowserEvidenceMilestone = "MS-026C" | "MS-027B";

export type BrowserEvidenceClassification =
  | "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY"
  | "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
  | "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE"
  | "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
  | "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
  | "FEED_ONBOARDING_EFFECT_ACCEPTED"
  | "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED"
  | "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE"
  | "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK"
  | "FEED_RECHECK_EFFECT_ACCEPTED"
  | "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK"
  | "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING"
  | "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET"
  | "PENDING_FEED_RECHECK_COOLDOWN"
  | "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION"
  | "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
  | "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  | "BROWSER_EVIDENCE_INVALID";

export type FeedRecheckEvidenceStatus =
  | "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET"
  | "PENDING_OPERATOR_ACTION"
  | "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
  | "FEED_RECHECK_EFFECT_ACCEPTED"
  | "PENDING_FEED_RECHECK_COOLDOWN"
  | "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
  | "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";

export type FeedOnboardingEvidenceStatus =
  | "FEED_ONBOARDING_EFFECT_ACCEPTED"
  | "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED"
  | "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE"
  | "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK"
  | "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING"
  | "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION"
  | "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";

export type RedactedBrowserEvidence = {
  readonly schema: typeof REDACTED_BROWSER_EVIDENCE_SCHEMA;
  readonly source: "admin-ui";
  readonly milestone: BrowserEvidenceMilestone;
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
      | "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
      | null;
  };
  readonly feedOnboarding: {
    readonly feed_onboarding_available: boolean;
    readonly feed_onboarding_status:
      | "available"
      | "accepted"
      | "already_present"
      | "pending_async_processing"
      | "pending_operator_action"
      | "rejected_safe_validation";
    readonly no_eligible_target: boolean;
    readonly critical_risk: "none";
    readonly effectStatus?: FeedOnboardingEvidenceStatus;
    readonly lastActionClassification?:
      | "FEED_ONBOARDING_ACTION_ACCEPTED"
      | "FEED_ONBOARDING_ACTION_ALREADY_EXISTS"
      | "FEED_ONBOARDING_ACTION_REJECTED_SAFE_VALIDATION"
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
  feedRechecks: Readonly<Record<string, { readonly result?: FeedRecheckResult }>> = {},
  feedOnboarding?: FeedOnboardingResult
): RedactedBrowserEvidence {
  const eligibleRecheckTargets = drilldown.feeds.rows.filter((row) => row.canRequestRecheck && row.actionRef !== null).length;
  const noEligible = eligibleRecheckTargets === 0;
  const feedRecheckEvidence = classifyFeedRecheckEvidence(eligibleRecheckTargets, feedRechecks);
  const feedOnboardingEvidence = classifyFeedOnboardingEvidence(feedOnboarding);
  const classifications: BrowserEvidenceClassification[] = [
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    feedOnboardingEvidence.effectStatus,
    feedRecheckEffectClassification(feedRecheckEvidence.effectStatus)
  ];
  if (noEligible) {
    classifications.push("BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET");
  } else if (feedRecheckEvidence.effectStatus === "FEED_RECHECK_EFFECT_ACCEPTED") {
    classifications.push("BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED");
  } else {
    classifications.push("BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET");
  }

  return {
    schema: REDACTED_BROWSER_EVIDENCE_SCHEMA,
    source: "admin-ui",
    milestone: "MS-027B",
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
      effectStatus: feedRecheckEvidence.effectStatus,
      lastActionClassification: feedRecheckEvidence.lastActionClassification
    },
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: feedOnboardingEvidence.feedOnboardingStatus,
      no_eligible_target: noEligible,
      critical_risk: "none",
      effectStatus: feedOnboardingEvidence.effectStatus,
      lastActionClassification: feedOnboardingEvidence.lastActionClassification
    },
    classifications: uniqueClassifications(classifications)
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
  if (!hasOnlyKeys(value, ["schema", "source", "milestone", "generatedAt", "authenticated", "operations", "feedRecheck", "feedOnboarding", "classifications"])) {
    return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason: "unknown_field" };
  }
  if (
    value.schema !== REDACTED_BROWSER_EVIDENCE_SCHEMA ||
    value.source !== "admin-ui" ||
    (value.milestone !== "MS-026C" && value.milestone !== "MS-027B") ||
    value.authenticated !== true ||
    !isIso(value.generatedAt) ||
    !isOperationsEvidence(value.operations) ||
    !isFeedRecheckEvidence(value.feedRecheck) ||
    !isFeedOnboardingEvidence(value.feedOnboarding) ||
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

function isFeedOnboardingEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "feed_onboarding_available",
      "feed_onboarding_status",
      "no_eligible_target",
      "critical_risk",
      "effectStatus",
      "lastActionClassification"
    ])
  ) {
    return false;
  }
  return (
    value.feed_onboarding_available === true &&
    isFeedOnboardingStatus(value.feed_onboarding_status) &&
    typeof value.no_eligible_target === "boolean" &&
    value.critical_risk === "none" &&
    (value.effectStatus === undefined || isFeedOnboardingEffectStatus(value.effectStatus)) &&
    (value.lastActionClassification === undefined || isFeedOnboardingActionClassification(value.lastActionClassification))
  );
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
      case "unavailable":
        return "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION";
      case "timeout":
      case "unauthenticated":
      case undefined:
        break;
    }
  }
  return null;
}

function classifyFeedRecheckEvidence(
  eligibleRecheckTargets: number,
  feedRechecks: Readonly<Record<string, { readonly result?: FeedRecheckResult }>>
): Pick<RedactedBrowserEvidence["feedRecheck"], "effectStatus" | "lastActionClassification"> {
  const lastActionClassification = latestSafeActionClassification(feedRechecks);
  switch (lastActionClassification) {
    case "FEED_RECHECK_ACTION_ACCEPTED":
    case "FEED_RECHECK_ACTION_ALREADY_PENDING":
      return { effectStatus: "FEED_RECHECK_EFFECT_ACCEPTED", lastActionClassification };
    case "FEED_RECHECK_ACTION_RATE_LIMITED":
      return { effectStatus: "PENDING_FEED_RECHECK_COOLDOWN", lastActionClassification };
    case "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION":
      return { effectStatus: "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION", lastActionClassification };
    case null:
      return {
        effectStatus: eligibleRecheckTargets === 0 ? "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET" : "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
        lastActionClassification
      };
  }
}

function feedRecheckEffectClassification(status: FeedRecheckEvidenceStatus): BrowserEvidenceClassification {
  switch (status) {
    case "FEED_RECHECK_EFFECT_ACCEPTED":
    case "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET":
    case "PENDING_FEED_RECHECK_COOLDOWN":
    case "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION":
    case "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON":
      return status;
    case "PENDING_OPERATOR_ACTION":
      return "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";
    case "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED":
      return "FEED_RECHECK_EFFECT_ACCEPTED";
  }
}

function classifyFeedOnboardingEvidence(feedOnboarding: FeedOnboardingResult | undefined): {
  readonly effectStatus: FeedOnboardingEvidenceStatus;
  readonly feedOnboardingStatus: RedactedBrowserEvidence["feedOnboarding"]["feed_onboarding_status"];
  readonly lastActionClassification: NonNullable<RedactedBrowserEvidence["feedOnboarding"]["lastActionClassification"]> | null;
} {
  switch (feedOnboarding?.kind) {
    case "created": {
      const accepted = feedOnboarding.response.feed?.eligibleForRecheck === true;
      return {
        effectStatus: accepted ? "FEED_ONBOARDING_EFFECT_ACCEPTED" : "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
        feedOnboardingStatus: accepted ? "accepted" : "pending_async_processing",
        lastActionClassification: "FEED_ONBOARDING_ACTION_ACCEPTED"
      };
    }
    case "already_exists": {
      const alreadyPresent = feedOnboarding.response.feed?.eligibleForRecheck === true;
      return {
        effectStatus: alreadyPresent ? "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE" : "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
        feedOnboardingStatus: alreadyPresent ? "already_present" : "pending_async_processing",
        lastActionClassification: "FEED_ONBOARDING_ACTION_ALREADY_EXISTS"
      };
    }
    case "rate_limited":
      return {
        effectStatus: "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
        feedOnboardingStatus: "pending_async_processing",
        lastActionClassification: null
      };
    case "forbidden":
    case "invalid_request":
    case "invalid_response":
    case "unavailable":
      return {
        effectStatus: "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
        feedOnboardingStatus: "rejected_safe_validation",
        lastActionClassification: "FEED_ONBOARDING_ACTION_REJECTED_SAFE_VALIDATION"
      };
    case "timeout":
    case "unauthenticated":
    case undefined:
      return {
        effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
        feedOnboardingStatus: "available",
        lastActionClassification: null
      };
  }
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
      value.effectStatus === "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED" ||
      value.effectStatus === "FEED_RECHECK_EFFECT_ACCEPTED" ||
      value.effectStatus === "PENDING_FEED_RECHECK_COOLDOWN" ||
      value.effectStatus === "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION" ||
      value.effectStatus === "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON") &&
    (value.lastActionClassification === null ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_ACCEPTED" ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_ALREADY_PENDING" ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_RATE_LIMITED" ||
      value.lastActionClassification === "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION")
  );
}

function isClassifications(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return false;
  const allowed = new Set<BrowserEvidenceClassification>([
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
    "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
    "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
    "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  ]);
  return value.every((classification) => typeof classification === "string" && allowed.has(classification as BrowserEvidenceClassification));
}

function isFeedOnboardingStatus(value: unknown): boolean {
  return (
    value === "available" ||
    value === "accepted" ||
    value === "already_present" ||
    value === "pending_async_processing" ||
    value === "pending_operator_action" ||
    value === "rejected_safe_validation"
  );
}

function isFeedOnboardingEffectStatus(value: unknown): boolean {
  return (
    value === "FEED_ONBOARDING_EFFECT_ACCEPTED" ||
    value === "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED" ||
    value === "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE" ||
    value === "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK" ||
    value === "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING" ||
    value === "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION" ||
    value === "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  );
}

function isFeedOnboardingActionClassification(value: unknown): boolean {
  return (
    value === null ||
    value === "FEED_ONBOARDING_ACTION_ACCEPTED" ||
    value === "FEED_ONBOARDING_ACTION_ALREADY_EXISTS" ||
    value === "FEED_ONBOARDING_ACTION_REJECTED_SAFE_VALIDATION"
  );
}

function uniqueClassifications(classifications: readonly BrowserEvidenceClassification[]): readonly BrowserEvidenceClassification[] {
  return [...new Set(classifications)];
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
