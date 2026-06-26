import { SERVER_MAX_DUE_LIMIT } from "./agent-due-feeds.policy";
import type { AgentDueFeedsQuery, ValidationResult } from "./agent-due-feeds.types";

const allowedQueryKeys = new Set(["limit"]);
const asciiDecimalDigits = /^[0-9]+$/u;

export function validateAgentDueFeedsQuery(query: unknown): ValidationResult<AgentDueFeedsQuery> {
  if (!isRecord(query)) {
    return invalid();
  }

  for (const key of Object.keys(query)) {
    if (!allowedQueryKeys.has(key)) {
      return invalid();
    }
  }

  const limit = parseRequiredLimit(query.limit);
  if (limit === undefined) {
    return invalid();
  }

  return { ok: true, value: { limit } };
}

function parseRequiredLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || value === "" || !asciiDecimalDigits.test(value)) {
    return undefined;
  }

  if (value.length > 1 && value.startsWith("0")) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > SERVER_MAX_DUE_LIMIT) {
    return undefined;
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): ValidationResult<never> {
  return { ok: false };
}
