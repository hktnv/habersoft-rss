import type { AgentHeartbeatRequest, ValidationResult } from "./agent-heartbeat.types";

const allowedHeartbeatFields = new Set([
  "status",
  "sent_at",
  "feeds_processed",
  "errors_count",
  "stale_check_results_dropped",
  "stale_entries_dropped"
]);
const forbiddenAgentIdFields = new Set(["agent_id", "agentId"]);
const postgresInt32Max = 2147483647;
const timezoneAwareInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export function validateAgentHeartbeatRequest(body: unknown): ValidationResult<AgentHeartbeatRequest> {
  if (!isRecord(body)) {
    return invalid();
  }

  for (const field of Object.keys(body)) {
    if (forbiddenAgentIdFields.has(field) || !allowedHeartbeatFields.has(field)) {
      return invalid();
    }
  }

  const status = body.status;
  if (typeof status !== "string" || status.trim() === "") {
    return invalid();
  }

  const sentAt = validateInstant(body.sent_at);
  if (sentAt === undefined) {
    return invalid();
  }

  const feedsProcessed = validateCounter(body.feeds_processed);
  const errorsCount = validateCounter(body.errors_count);
  const staleCheckResultsDropped = validateCounter(body.stale_check_results_dropped);
  const staleEntriesDropped = validateCounter(body.stale_entries_dropped);

  if (
    feedsProcessed === undefined ||
    errorsCount === undefined ||
    staleCheckResultsDropped === undefined ||
    staleEntriesDropped === undefined
  ) {
    return invalid();
  }

  return {
    ok: true,
    value: {
      status,
      sentAt,
      feedsProcessed,
      errorsCount,
      staleCheckResultsDropped,
      staleEntriesDropped
    }
  };
}

export function validateNoQueryParameters(query: unknown): ValidationResult<undefined> {
  if (!isRecord(query) || Object.keys(query).length > 0) {
    return invalid();
  }

  return { ok: true, value: undefined };
}

function validateInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || !timezoneAwareInstantPattern.test(value)) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() === undefined) {
    return undefined;
  }

  return parsed;
}

function validateCounter(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > postgresInt32Max) {
    return undefined;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): ValidationResult<never> {
  return { ok: false };
}
