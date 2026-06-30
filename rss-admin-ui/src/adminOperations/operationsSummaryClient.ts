export const ADMIN_OPERATIONS_SUMMARY_PATH = "/admin-api/operations/summary" as const;

export type DependencyState = "up" | "down" | "unknown";

export type OperationsSummary = {
  readonly status: "ok";
  readonly generatedAt: string;
  readonly window: {
    readonly recentHours: 24;
  };
  readonly dependencies: {
    readonly postgres: DependencyState;
    readonly redis: DependencyState;
    readonly tenantAuth: DependencyState;
  };
  readonly feeds: {
    readonly total: number | null;
    readonly active: number | null;
    readonly disabled: number | null;
    readonly dueNow: number | null;
  };
  readonly entries: {
    readonly total: number | null;
    readonly createdLast24h: number | null;
  };
  readonly ingestion: {
    readonly checksLast24h: number | null;
    readonly successLast24h: number | null;
    readonly failedLast24h: number | null;
    readonly latestCheckAt: string | null;
  };
  readonly notes: readonly {
    readonly code: string;
    readonly message: string;
  }[];
};

export type OperationsSummaryResult =
  | {
      readonly kind: "success";
      readonly httpStatus: 200;
      readonly summary: OperationsSummary;
    }
  | {
      readonly kind: "unauthenticated" | "unavailable" | "invalid_response" | "timeout";
      readonly httpStatus?: number;
      readonly message: string;
    };

export type FetchOperationsSummaryOptions = {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const timeoutMs = 5000;
const unsafeNoteFieldPattern = new RegExp(
  [
    "secret",
    "password",
    "token",
    "cookie",
    "authorization",
    "bearer",
    ["database", "url"].join("_"),
    ["redis", "url"].join("_")
  ].join("|") + String.raw`\s*[:=]`,
  "iu"
);

export const operationsSummaryClientContract = {
  path: ADMIN_OPERATIONS_SUMMARY_PATH,
  method: "GET",
  credentials: "same-origin",
  cache: "no-store",
  browserPersistence: false,
  customCredentialHeaders: false,
  queryForwarding: false,
  writeMethods: false
} as const;

export async function fetchOperationsSummary(
  options: FetchOperationsSummaryOptions = {}
): Promise<OperationsSummaryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);

  try {
    const response = await fetchImpl(ADMIN_OPERATIONS_SUMMARY_PATH, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      signal: abort.signal
    });

    return await parseOperationsSummaryResponse(response);
  } catch (error) {
    if (abort.didTimeout()) {
      return {
        kind: "timeout",
        message: "Admin operations summary request timed out."
      };
    }
    if (isAbortError(error)) {
      return {
        kind: "unavailable",
        message: "Admin operations summary request could not be verified."
      };
    }
    return {
      kind: "unavailable",
      message: "Admin operations API is unavailable."
    };
  } finally {
    abort.cleanup();
  }
}

export async function parseOperationsSummaryResponse(response: Response): Promise<OperationsSummaryResult> {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return invalidResponse(response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return invalidResponse(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return invalidResponse(response.status);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      kind: "unauthenticated",
      httpStatus: response.status,
      message: "Admin session expired. Sign in again to view operations."
    };
  }

  if (response.status === 501 || response.status === 502 || response.status === 503 || response.status === 504) {
    return {
      kind: "unavailable",
      httpStatus: response.status,
      message: "Admin operations API is unavailable. After backend or network changes, recreate the frontend with the canonical helper."
    };
  }

  if (response.status !== 200) {
    return invalidResponse(response.status);
  }

  const summary = parseOperationsSummary(body);
  if (summary === undefined) {
    return invalidResponse(response.status);
  }

  return {
    kind: "success",
    httpStatus: 200,
    summary
  };
}

function parseOperationsSummary(value: unknown): OperationsSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status !== "ok") return undefined;
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return undefined;
  if (!isRecord(value.window) || value.window.recentHours !== 24) return undefined;
  if (!isDependencies(value.dependencies)) return undefined;
  if (!isMetricGroup(value.feeds, ["total", "active", "disabled", "dueNow"])) return undefined;
  if (!isMetricGroup(value.entries, ["total", "createdLast24h"])) return undefined;
  if (!isIngestion(value.ingestion)) return undefined;
  if (!Array.isArray(value.notes) || !value.notes.every(isSafeNote)) return undefined;

  return value as OperationsSummary;
}

function isDependencies(value: unknown): value is OperationsSummary["dependencies"] {
  if (!isRecord(value)) return false;
  return isDependencyState(value.postgres) && isDependencyState(value.redis) && isDependencyState(value.tenantAuth);
}

function isDependencyState(value: unknown): value is DependencyState {
  return value === "up" || value === "down" || value === "unknown";
}

function isMetricGroup(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  return keys.every((key) => isNullableCount(value[key]));
}

function isIngestion(value: unknown): value is OperationsSummary["ingestion"] {
  if (!isRecord(value)) return false;
  return (
    isNullableCount(value.checksLast24h) &&
    isNullableCount(value.successLast24h) &&
    isNullableCount(value.failedLast24h) &&
    (value.latestCheckAt === null || (typeof value.latestCheckAt === "string" && !Number.isNaN(Date.parse(value.latestCheckAt))))
  );
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isSafeNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.code !== "string" || !/^[a-z0-9_]{1,64}$/u.test(value.code)) return false;
  if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 240) return false;
  return !unsafeNoteFieldPattern.test(value.message);
}

function invalidResponse(httpStatus?: number): OperationsSummaryResult {
  return {
    kind: "invalid_response",
    httpStatus,
    message: "Admin operations summary response could not be validated."
  };
}

function createRequestAbort(options: FetchOperationsSummaryOptions): {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? timeoutMs);

  const abortFromParent = () => {
    controller.abort();
  };

  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromParent);
    }
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
