export const ADMIN_OPERATIONS_DRILLDOWN_PATH = "/admin-api/operations/drilldown" as const;

export type DrilldownStatus = "ok" | "partial" | "unavailable";
export type FeedHealth = "healthy" | "degraded" | "unknown";
export type LastResult = "success" | "failure" | "unknown";
export type IngestionRowStatus = "accepted" | "skipped" | "unknown";
export type RecheckUnavailableReason = "admin_auth_not_configured" | "inactive_feed" | "no_subscribers" | "source_host_redacted";

export type OperationsDrilldown = {
  readonly status: DrilldownStatus;
  readonly generatedAt: string;
  readonly window: {
    readonly recentHours: 24;
    readonly maxRows: 20;
  };
  readonly feeds: {
    readonly status: DrilldownStatus;
    readonly total: number | null;
    readonly active: number | null;
    readonly due: number | null;
    readonly withRecentSuccess: number | null;
    readonly withRecentFailure: number | null;
    readonly rows: readonly FeedDrilldownRow[];
  };
  readonly ingestion: {
    readonly status: DrilldownStatus;
    readonly recentEntryCount: number | null;
    readonly recentBatchCount: number | null;
    readonly latestEntryAt: string | null;
    readonly rows: readonly IngestionDrilldownRow[];
  };
  readonly notes: readonly string[];
  readonly capabilities: {
    readonly feedRows: boolean;
    readonly ingestionRows: boolean;
    readonly reason: string | null;
  };
};

export type FeedDrilldownRow = {
  readonly displayId: string;
  readonly displayName: string | null;
  readonly sourceHost: string | null;
  readonly health: FeedHealth;
  readonly lastCheckedAt: string | null;
  readonly lastResult: LastResult;
  readonly recentEntryCount: number | null;
  readonly notes: readonly string[];
  readonly canRequestRecheck: boolean;
  readonly recheckUnavailableReason: RecheckUnavailableReason | null;
  readonly actionRef: string | null;
};

export type IngestionDrilldownRow = {
  readonly displayId: string;
  readonly feedDisplayId: string | null;
  readonly receivedAt: string | null;
  readonly entryCount: number | null;
  readonly status: IngestionRowStatus;
  readonly notes: readonly string[];
};

export type OperationsDrilldownResult =
  | {
      readonly kind: "success";
      readonly httpStatus: 200;
      readonly drilldown: OperationsDrilldown;
    }
  | {
      readonly kind: "unauthenticated" | "unavailable" | "invalid_response" | "timeout";
      readonly httpStatus?: number;
      readonly message: string;
    };

export type FetchOperationsDrilldownOptions = {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const timeoutMs = 5000;
const maxRows = 20;
const displayIdPattern = /^(?:feed|check)_[a-f0-9]{10}$/u;
const actionRefPattern = /^feed_recheck_v1\.[A-Za-z0-9_-]{48,512}$/u;
const hostnamePattern = /^(?=.{1,120}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const unsafeTextPattern = new RegExp(
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

export const operationsDrilldownClientContract = {
  path: ADMIN_OPERATIONS_DRILLDOWN_PATH,
  method: "GET",
  credentials: "same-origin",
  cache: "no-store",
  browserPersistence: false,
  customCredentialHeaders: false,
  queryForwarding: false,
  writeMethods: false,
  feedRecheckActionMetadata: true,
  polling: false
} as const;

export async function fetchOperationsDrilldown(
  options: FetchOperationsDrilldownOptions = {}
): Promise<OperationsDrilldownResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);

  try {
    const response = await fetchImpl(ADMIN_OPERATIONS_DRILLDOWN_PATH, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      signal: abort.signal
    });

    return await parseOperationsDrilldownResponse(response);
  } catch (error) {
    if (abort.didTimeout()) {
      return {
        kind: "timeout",
        message: "Admin operations drilldown request timed out."
      };
    }
    if (isAbortError(error)) {
      return {
        kind: "unavailable",
        message: "Admin operations drilldown request could not be verified."
      };
    }
    return {
      kind: "unavailable",
      message: "Admin operations drilldown API is unavailable."
    };
  } finally {
    abort.cleanup();
  }
}

export async function parseOperationsDrilldownResponse(response: Response): Promise<OperationsDrilldownResult> {
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
      message: "Admin session expired. Sign in again to view operations drilldown."
    };
  }

  if (response.status === 501 || response.status === 502 || response.status === 503 || response.status === 504) {
    return {
      kind: "unavailable",
      httpStatus: response.status,
      message: "Admin operations drilldown API is unavailable. After backend or network changes, recreate the frontend with the canonical helper."
    };
  }

  if (response.status !== 200) {
    return invalidResponse(response.status);
  }

  const drilldown = parseOperationsDrilldown(body);
  if (drilldown === undefined) {
    return invalidResponse(response.status);
  }

  return {
    kind: "success",
    httpStatus: 200,
    drilldown
  };
}

function parseOperationsDrilldown(value: unknown): OperationsDrilldown | undefined {
  if (!isRecord(value)) return undefined;
  if (!isDrilldownStatus(value.status)) return undefined;
  if (!isIso(value.generatedAt)) return undefined;
  if (!isRecord(value.window) || value.window.recentHours !== 24 || value.window.maxRows !== maxRows) return undefined;
  if (!isFeeds(value.feeds)) return undefined;
  if (!isIngestion(value.ingestion)) return undefined;
  if (!isSafeNotes(value.notes)) return undefined;
  if (!isCapabilities(value.capabilities)) return undefined;
  return value as OperationsDrilldown;
}

function isFeeds(value: unknown): value is OperationsDrilldown["feeds"] {
  if (!isRecord(value)) return false;
  return (
    isDrilldownStatus(value.status) &&
    isNullableCount(value.total) &&
    isNullableCount(value.active) &&
    isNullableCount(value.due) &&
    isNullableCount(value.withRecentSuccess) &&
    isNullableCount(value.withRecentFailure) &&
    Array.isArray(value.rows) &&
    value.rows.length <= maxRows &&
    value.rows.every(isFeedRow)
  );
}

function isFeedRow(value: unknown): value is FeedDrilldownRow {
  if (!isRecord(value)) return false;
  return (
    isDisplayId(value.displayId, "feed") &&
    (value.displayName === null || isSafeDisplayText(value.displayName)) &&
    (value.sourceHost === null || isSafeHost(value.sourceHost)) &&
    isFeedHealth(value.health) &&
    (value.lastCheckedAt === null || isIso(value.lastCheckedAt)) &&
    isLastResult(value.lastResult) &&
    isNullableCount(value.recentEntryCount) &&
    isSafeNotes(value.notes) &&
    isRecheckMetadata(value)
  );
}

function isRecheckMetadata(value: Record<string, unknown>): boolean {
  if (typeof value.canRequestRecheck !== "boolean") return false;
  if (value.canRequestRecheck) {
    return value.recheckUnavailableReason === null && typeof value.actionRef === "string" && actionRefPattern.test(value.actionRef);
  }

  return isRecheckUnavailableReason(value.recheckUnavailableReason) && value.actionRef === null;
}

function isRecheckUnavailableReason(value: unknown): value is RecheckUnavailableReason {
  return value === "admin_auth_not_configured" || value === "inactive_feed" || value === "no_subscribers" || value === "source_host_redacted";
}

function isIngestion(value: unknown): value is OperationsDrilldown["ingestion"] {
  if (!isRecord(value)) return false;
  return (
    isDrilldownStatus(value.status) &&
    isNullableCount(value.recentEntryCount) &&
    isNullableCount(value.recentBatchCount) &&
    (value.latestEntryAt === null || isIso(value.latestEntryAt)) &&
    Array.isArray(value.rows) &&
    value.rows.length <= maxRows &&
    value.rows.every(isIngestionRow)
  );
}

function isIngestionRow(value: unknown): value is IngestionDrilldownRow {
  if (!isRecord(value)) return false;
  return (
    isDisplayId(value.displayId, "check") &&
    (value.feedDisplayId === null || isDisplayId(value.feedDisplayId, "feed")) &&
    (value.receivedAt === null || isIso(value.receivedAt)) &&
    isNullableCount(value.entryCount) &&
    isIngestionRowStatus(value.status) &&
    isSafeNotes(value.notes)
  );
}

function isCapabilities(value: unknown): value is OperationsDrilldown["capabilities"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.feedRows === "boolean" &&
    typeof value.ingestionRows === "boolean" &&
    (value.reason === null || isSafeDisplayText(value.reason))
  );
}

function isDrilldownStatus(value: unknown): value is DrilldownStatus {
  return value === "ok" || value === "partial" || value === "unavailable";
}

function isFeedHealth(value: unknown): value is FeedHealth {
  return value === "healthy" || value === "degraded" || value === "unknown";
}

function isLastResult(value: unknown): value is LastResult {
  return value === "success" || value === "failure" || value === "unknown";
}

function isIngestionRowStatus(value: unknown): value is IngestionRowStatus {
  return value === "accepted" || value === "skipped" || value === "unknown";
}

function isDisplayId(value: unknown, prefix: "feed" | "check"): boolean {
  return typeof value === "string" && displayIdPattern.test(value) && value.startsWith(`${prefix}_`);
}

function isNullableCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isSafeHost(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.includes("/") || value.includes("?") || value.includes("#") || value.includes(":")) return false;
  return hostnamePattern.test(value);
}

function isSafeDisplayText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > 180) return false;
  if (unsafeTextPattern.test(value) || /https?:\/\//iu.test(value)) return false;
  return true;
}

function isSafeNotes(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 12 && value.every(isSafeDisplayText);
}

function invalidResponse(httpStatus?: number): OperationsDrilldownResult {
  return {
    kind: "invalid_response",
    httpStatus,
    message: "Admin operations drilldown response could not be validated."
  };
}

function createRequestAbort(options: FetchOperationsDrilldownOptions): {
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
