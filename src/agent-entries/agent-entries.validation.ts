import { MAX_AGENT_ENTRIES_PER_REQUEST } from "./agent-entries.policy";
import type {
  AgentEntriesRequest,
  AgentEntryInput,
  DetailExtractionInput,
  DetailExtractionStatus,
  ValidationResult
} from "./agent-entries.types";

const allowedRootKeys = new Set([
  "check_id",
  "feed_id",
  "checked_at",
  "tier_attempted",
  "feed_title",
  "response_etag",
  "response_last_modified",
  "entries"
]);
const allowedEntryKeys = new Set([
  "guid",
  "url",
  "title",
  "summary",
  "images",
  "videos",
  "tags",
  "author",
  "meta",
  "published_at",
  "detail",
  "detail_extraction"
]);
const allowedDetailExtractionKeys = new Set(["status", "attempted_at", "finalized_at", "error_code"]);
const detailStatuses = new Set<DetailExtractionStatus>([
  "ok",
  "timeout",
  "playwright_failed",
  "blocked",
  "empty_content",
  "normalizer_rejected",
  "skipped_budget_exceeded"
]);
const postgresBigIntMax = 9223372036854775807n;
const checkIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const timezoneAwareInstantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function validateAgentEntriesRequest(body: unknown, query: unknown): ValidationResult<AgentEntriesRequest> {
  if (!isRecord(query) || Object.keys(query).length > 0 || !isRecord(body) || !hasOnlyKeys(body, allowedRootKeys)) {
    return invalid("VALIDATION_FAILED");
  }

  const checkId = validateCheckId(body.check_id);
  const feedId = validateFeedId(body.feed_id);
  const checkedAt = validateInstant(body.checked_at);
  const tierAttempted = validateTierAttempted(body.tier_attempted);
  const feedTitle = validateOptionalText(body.feed_title, 500, false);
  const responseEtag = validateOptionalText(body.response_etag, 1024, false);
  const responseLastModified = validateOptionalText(body.response_last_modified, 1024, false);
  const entries = validateEntries(body.entries);

  if (
    checkId === undefined ||
    feedId === undefined ||
    checkedAt === undefined ||
    tierAttempted === undefined ||
    feedTitle === undefined ||
    responseEtag === undefined ||
    responseLastModified === undefined ||
    entries === undefined
  ) {
    return invalid("VALIDATION_FAILED");
  }

  return {
    ok: true,
    value: {
      checkId,
      feedId,
      checkedAt,
      tierAttempted,
      feedTitle,
      responseEtag,
      responseLastModified,
      entries
    }
  };
}

function validateEntries(value: unknown): readonly AgentEntryInput[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AGENT_ENTRIES_PER_REQUEST) {
    return undefined;
  }

  const seenGuids = new Set<string>();
  const entries: AgentEntryInput[] = [];

  for (const item of value) {
    const entry = validateEntry(item);
    if (entry === undefined || seenGuids.has(entry.guid)) {
      return undefined;
    }

    seenGuids.add(entry.guid);
    entries.push(entry);
  }

  return entries;
}

function validateEntry(value: unknown): AgentEntryInput | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedEntryKeys)) {
    return undefined;
  }

  const guid = validateText(value.guid, 1024, false);
  const url = validateHttpUrl(value.url, 2048);
  const title = validateText(value.title, 500, false);
  const summary = validateOptionalText(value.summary, 5000, true);
  const images = validateOptionalUrlArray(value.images, 20);
  const videos = validateOptionalUrlArray(value.videos, 5);
  const tags = validateOptionalTextArray(value.tags, 50, 500);
  const author = validateOptionalText(value.author, 500, true);
  const meta = validateOptionalMeta(value.meta);
  const publishedAt = validateOptionalInstant(value.published_at);
  const detailExtraction = validateDetailExtraction(value.detail_extraction);
  const detail = validateDetail(value.detail, detailExtraction);

  if (
    guid === undefined ||
    url === undefined ||
    title === undefined ||
    summary === undefined ||
    images === undefined ||
    videos === undefined ||
    tags === undefined ||
    author === undefined ||
    meta === undefined ||
    publishedAt === undefined ||
    detailExtraction === undefined ||
    detail === undefined
  ) {
    return undefined;
  }

  return {
    guid,
    url,
    title,
    summary,
    images,
    videos,
    tags,
    author,
    meta,
    publishedAt,
    detail,
    detailExtraction
  };
}

function validateDetailExtraction(value: unknown): DetailExtractionInput | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedDetailExtractionKeys)) {
    return undefined;
  }

  const status = validateDetailStatus(value.status);
  const finalizedAt = validateInstant(value.finalized_at);
  const attemptedAt = validateNullableInstant(value.attempted_at);
  const errorCode = validateOptionalText(value.error_code, 100, true);

  if (status === undefined || finalizedAt === undefined || attemptedAt === undefined || errorCode === undefined) {
    return undefined;
  }

  if (status === "ok") {
    if (errorCode !== null || attemptedAt === null) {
      return undefined;
    }
  } else if (status === "skipped_budget_exceeded") {
    if (attemptedAt !== null) {
      return undefined;
    }
  } else if (attemptedAt === null) {
    return undefined;
  }

  if (attemptedAt !== null && attemptedAt.getTime() > finalizedAt.getTime()) {
    return undefined;
  }

  return {
    status,
    attemptedAt,
    finalizedAt,
    errorCode
  };
}

function validateDetail(value: unknown, detailExtraction: DetailExtractionInput | undefined): string | null | undefined {
  if (detailExtraction === undefined) {
    return undefined;
  }

  if (detailExtraction.status === "ok") {
    return validateText(value, 30000, true);
  }

  return value === null ? null : undefined;
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

function validateTierAttempted(value: unknown): number | undefined {
  return value === 1 || value === 2 ? value : undefined;
}

function validateDetailStatus(value: unknown): DetailExtractionStatus | undefined {
  return typeof value === "string" && detailStatuses.has(value as DetailExtractionStatus)
    ? (value as DetailExtractionStatus)
    : undefined;
}

function validateOptionalMeta(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value) || Object.keys(value).length > 50) {
    return undefined;
  }

  return value;
}

function validateOptionalUrlArray(value: unknown, maxItems: number): readonly string[] | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value) || value.length > maxItems) {
    return undefined;
  }

  const urls: string[] = [];
  for (const item of value) {
    const url = validateHttpUrl(item, 2048);
    if (url === undefined) {
      return undefined;
    }

    urls.push(url);
  }

  return urls;
}

function validateOptionalTextArray(
  value: unknown,
  maxItems: number,
  maxCodePoints: number
): readonly string[] | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value) || value.length > maxItems) {
    return undefined;
  }

  const items: string[] = [];
  for (const item of value) {
    const text = validateText(item, maxCodePoints, true);
    if (text === undefined) {
      return undefined;
    }

    items.push(text);
  }

  return items;
}

function validateOptionalText(
  value: unknown,
  maxCodePoints: number,
  allowEmpty: boolean
): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  return validateText(value, maxCodePoints, allowEmpty);
}

function validateText(value: unknown, maxCodePoints: number, allowEmpty: boolean): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value !== value.trim()) {
    return undefined;
  }

  const length = Array.from(value).length;
  if ((!allowEmpty && length < 1) || length > maxCodePoints) {
    return undefined;
  }

  return value;
}

function validateHttpUrl(value: unknown, maxCodePoints: number): string | undefined {
  const text = validateText(value, maxCodePoints, false);
  if (text === undefined || /[\s]/u.test(text)) {
    return undefined;
  }

  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? text : undefined;
  } catch {
    return undefined;
  }
}

function validateOptionalInstant(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  return validateInstant(value);
}

function validateNullableInstant(value: unknown): Date | null | undefined {
  if (value === null) {
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

function invalid(errorCode: "VALIDATION_FAILED"): ValidationResult<never> {
  return { ok: false, errorCode };
}
