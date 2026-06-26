import type { AgentNewGuidsRequest, ValidationResult } from "./agent-new-guids.types";

const allowedBodyKeys = new Set(["guids"]);
const postgresBigIntMax = 9223372036854775807n;
const guidMaxCodePoints = 2048;
const maxGuidsPerRequest = 100;

export function validateAgentNewGuidsRequest(
  feedId: unknown,
  body: unknown,
  query: unknown
): ValidationResult<AgentNewGuidsRequest> {
  const validatedFeedId = validateAgentFeedId(feedId);
  const validatedBody = validateAgentNewGuidsBody(body);
  const validatedQuery = validateNoQueryParameters(query);

  if (!validatedFeedId.ok || !validatedBody.ok || !validatedQuery.ok) {
    return invalid();
  }

  return {
    ok: true,
    value: {
      feedId: validatedFeedId.value,
      guids: validatedBody.value
    }
  };
}

export function validateAgentFeedId(value: unknown): ValidationResult<bigint> {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return invalid();
  }

  const parsed = BigInt(value);
  if (parsed > postgresBigIntMax) {
    return invalid();
  }

  return { ok: true, value: parsed };
}

export function validateAgentNewGuidsBody(body: unknown): ValidationResult<readonly string[]> {
  if (!isRecord(body)) {
    return invalid();
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || !allowedBodyKeys.has(keys[0] ?? "")) {
    return invalid();
  }

  const guids = body.guids;
  if (!Array.isArray(guids) || guids.length < 1 || guids.length > maxGuidsPerRequest) {
    return invalid();
  }

  for (const guid of guids) {
    if (!isValidGuid(guid)) {
      return invalid();
    }
  }

  return { ok: true, value: guids };
}

export function validateNoQueryParameters(query: unknown): ValidationResult<undefined> {
  if (!isRecord(query) || Object.keys(query).length > 0) {
    return invalid();
  }

  return { ok: true, value: undefined };
}

function isValidGuid(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return false;
  }

  const codePointLength = Array.from(value).length;
  return codePointLength >= 1 && codePointLength <= guidMaxCodePoints;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): ValidationResult<never> {
  return { ok: false };
}
