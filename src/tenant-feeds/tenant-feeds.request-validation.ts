export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
    };

export type SubscribeFeedRequest = {
  readonly url: string;
};

const allowedSubscribeFields = new Set(["url"]);
const forbiddenTenantOverrideFields = new Set([
  "site_client_id",
  "siteClientId",
  "tenant_id",
  "tenantId",
  "client_id",
  "clientId"
]);
const postgresBigIntMax = 9223372036854775807n;

export function validateSubscribeFeedRequest(body: unknown): ValidationResult<SubscribeFeedRequest> {
  if (!isRecord(body)) {
    return invalid();
  }

  for (const field of Object.keys(body)) {
    if (forbiddenTenantOverrideFields.has(field) || !allowedSubscribeFields.has(field)) {
      return invalid();
    }
  }

  const url = body.url;
  if (typeof url !== "string") {
    return invalid();
  }

  if (url.length === 0 || url.trim() !== url) {
    return invalid();
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return invalid();
    }
  } catch {
    return invalid();
  }

  return {
    ok: true,
    value: { url }
  };
}

export function validateNoQueryParameters(query: unknown): ValidationResult<undefined> {
  if (!isRecord(query)) {
    return invalid();
  }

  if (Object.keys(query).length > 0) {
    return invalid();
  }

  return {
    ok: true,
    value: undefined
  };
}

export function validateFeedId(value: unknown): ValidationResult<bigint> {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return invalid();
  }

  const feedId = BigInt(value);
  if (feedId > postgresBigIntMax) {
    return invalid();
  }

  return {
    ok: true,
    value: feedId
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): ValidationResult<never> {
  return { ok: false };
}
