export type TenantEntriesQuery =
  | {
      readonly ok: true;
      readonly value: {
        readonly offset: number;
        readonly limit: number;
      };
    }
  | {
      readonly ok: false;
    };

const allowedQueryKeys = new Set(["offset", "limit"]);
const tenantOverrideKeys = new Set([
  "site_client_id",
  "siteClientId",
  "tenant_id",
  "tenantId",
  "client_id",
  "clientId"
]);

export const defaultEntryListOffset = 0;
export const maxEntryListOffset = 1000;
export const defaultEntryListLimit = 50;
export const maxEntryListLimit = 100;

export function validateTenantEntriesQuery(query: unknown): TenantEntriesQuery {
  if (!isRecord(query)) {
    return { ok: false };
  }

  for (const key of Object.keys(query)) {
    if (tenantOverrideKeys.has(key) || !allowedQueryKeys.has(key)) {
      return { ok: false };
    }
  }

  const offset = parseOptionalBoundedInteger(query.offset, defaultEntryListOffset, 0, maxEntryListOffset);
  const limit = parseOptionalBoundedInteger(query.limit, defaultEntryListLimit, 1, maxEntryListLimit);

  if (offset === undefined || limit === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      offset,
      limit
    }
  };
}

function parseOptionalBoundedInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return undefined;
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
