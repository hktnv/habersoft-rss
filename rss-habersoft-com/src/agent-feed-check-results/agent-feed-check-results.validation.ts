import { MAX_AGENT_FEED_CHECK_RESULTS_PER_REQUEST } from "./agent-feed-check-results.policy";
import type {
  AgentFeedCheckOutcome,
  AgentFeedCheckResultInput,
  AgentFeedCheckResultsRequest,
  AgentFeedCheckResultsValidationErrorCode,
  ValidationResult
} from "./agent-feed-check-results.types";

const allowedRootKeys = new Set(["flush_id", "sent_at", "results"]);
const allowedResultKeys = new Set([
  "check_id",
  "feed_id",
  "checked_at",
  "outcome",
  "http_status",
  "error_code",
  "tier_attempted",
  "response_etag",
  "response_last_modified",
  "feed_title"
]);
const outcomes = new Set<AgentFeedCheckOutcome>(["not_modified", "no_new_entries", "fetch_error"]);
const postgresBigIntMax = 9223372036854775807n;
const checkIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const timezoneAwareInstantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function validateAgentFeedCheckResultsRequest(
  body: unknown,
  query: unknown
): ValidationResult<AgentFeedCheckResultsRequest> {
  if (!isRecord(query) || Object.keys(query).length > 0 || !isRecord(body) || !hasOnlyKeys(body, allowedRootKeys)) {
    return invalid("VALIDATION_FAILED");
  }

  const flushId = validateOptionalText(body.flush_id, 128, false);
  const sentAt = validateOptionalInstant(body.sent_at);
  const results = validateResults(body.results);

  if (flushId === undefined || sentAt === undefined || results === undefined) {
    return invalid(results === undefined && Array.isArray(body.results) && body.results.length === 0
      ? "FEED_CHECK_RESULTS_EMPTY"
      : "VALIDATION_FAILED");
  }

  return {
    ok: true,
    value: {
      flushId,
      sentAt,
      results
    }
  };
}

function validateResults(value: unknown): readonly AgentFeedCheckResultInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.length === 0 || value.length > MAX_AGENT_FEED_CHECK_RESULTS_PER_REQUEST) {
    return undefined;
  }

  const results: AgentFeedCheckResultInput[] = [];
  for (const item of value) {
    const result = validateResult(item);
    if (result === undefined) {
      return undefined;
    }

    results.push(result);
  }

  return results;
}

function validateResult(value: unknown): AgentFeedCheckResultInput | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedResultKeys)) {
    return undefined;
  }

  const checkId = validateCheckId(value.check_id);
  const feedId = validateFeedId(value.feed_id);
  const checkedAt = validateInstant(value.checked_at);
  const outcome = validateOutcome(value.outcome);
  const httpStatus = validateHttpStatus(value.http_status);
  const tierAttempted = validateTierAttempted(value.tier_attempted);

  if (
    checkId === undefined ||
    feedId === undefined ||
    checkedAt === undefined ||
    outcome === undefined ||
    httpStatus === undefined ||
    tierAttempted === undefined
  ) {
    return undefined;
  }

  const errorCode = validateErrorCode(value.error_code, outcome);
  const validators = validateValidators(value, outcome);
  const feedTitle = validateFeedTitle(value.feed_title, outcome);

  if (errorCode === undefined || validators === undefined || feedTitle === undefined) {
    return undefined;
  }

  if (!isHttpStatusAllowed(outcome, httpStatus)) {
    return undefined;
  }

  return {
    checkId,
    feedId,
    checkedAt,
    outcome,
    httpStatus,
    errorCode,
    tierAttempted,
    responseEtag: validators.responseEtag,
    responseLastModified: validators.responseLastModified,
    feedTitle
  };
}

function validateErrorCode(value: unknown, outcome: AgentFeedCheckOutcome): string | null | undefined {
  if (outcome === "fetch_error") {
    return validateText(value, 100, false);
  }

  return value === null ? null : undefined;
}

function validateValidators(
  value: Record<string, unknown>,
  outcome: AgentFeedCheckOutcome
): { readonly responseEtag: string | null; readonly responseLastModified: string | null } | undefined {
  const hasEtag = Object.prototype.hasOwnProperty.call(value, "response_etag");
  const hasLastModified = Object.prototype.hasOwnProperty.call(value, "response_last_modified");

  if (outcome === "fetch_error") {
    return hasEtag || hasLastModified ? undefined : { responseEtag: null, responseLastModified: null };
  }

  if (outcome === "no_new_entries" && (!hasEtag || !hasLastModified)) {
    return undefined;
  }

  const responseEtag = hasEtag ? validateNullableText(value.response_etag, 1024, false) : null;
  const responseLastModified = hasLastModified ? validateNullableText(value.response_last_modified, 256, false) : null;

  if (responseEtag === undefined || responseLastModified === undefined) {
    return undefined;
  }

  return { responseEtag, responseLastModified };
}

function validateFeedTitle(value: unknown, outcome: AgentFeedCheckOutcome): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (outcome !== "no_new_entries") {
    return undefined;
  }

  if (typeof value !== "string" || value !== value.trim()) {
    return undefined;
  }

  const length = Array.from(value).length;
  if (length === 0) {
    return undefined;
  }

  if (length > 300) {
    return undefined;
  }

  return value;
}

function validateCheckId(value: unknown): string | undefined {
  return typeof value === "string" && checkIdPattern.test(value) ? value : undefined;
}

function validateFeedId(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return undefined;
  }

  const parsed = BigInt(value);
  return parsed <= postgresBigIntMax ? parsed : undefined;
}

function validateOutcome(value: unknown): AgentFeedCheckOutcome | undefined {
  return typeof value === "string" && outcomes.has(value as AgentFeedCheckOutcome)
    ? (value as AgentFeedCheckOutcome)
    : undefined;
}

function validateHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 599 ? value : undefined;
}

function validateTierAttempted(value: unknown): number | undefined {
  return value === 1 || value === 2 ? value : undefined;
}

function isHttpStatusAllowed(outcome: AgentFeedCheckOutcome, httpStatus: number): boolean {
  if (outcome === "not_modified") {
    return httpStatus === 304;
  }

  if (outcome === "no_new_entries") {
    return httpStatus === 200;
  }

  return httpStatus !== 304;
}

function validateOptionalInstant(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  return validateInstant(value);
}

function validateInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || !timezoneAwareInstantPattern.test(value)) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function validateOptionalText(value: unknown, maxCodePoints: number, allowEmpty: boolean): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  return validateText(value, maxCodePoints, allowEmpty);
}

function validateNullableText(value: unknown, maxCodePoints: number, allowEmpty: boolean): string | null | undefined {
  if (value === null) {
    return null;
  }

  return validateText(value, maxCodePoints, allowEmpty);
}

function validateText(value: unknown, maxCodePoints: number, allowEmpty: boolean): string | undefined {
  if (typeof value !== "string" || value !== value.trim()) {
    return undefined;
  }

  const length = Array.from(value).length;
  if ((!allowEmpty && length < 1) || length > maxCodePoints) {
    return undefined;
  }

  return value;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(errorCode: AgentFeedCheckResultsValidationErrorCode): ValidationResult<never> {
  return { ok: false, errorCode };
}
