export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
    };

const postgresBigIntMax = 9223372036854775807n;

export function validateTenantEntryId(value: unknown): ValidationResult<bigint> {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return invalid();
  }

  const parsed = BigInt(value);
  if (parsed > postgresBigIntMax) {
    return invalid();
  }

  return {
    ok: true,
    value: parsed
  };
}

export function validateNoDetailQueryParameters(query: unknown): ValidationResult<undefined> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): ValidationResult<never> {
  return { ok: false };
}
