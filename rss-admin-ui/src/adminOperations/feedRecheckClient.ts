export const ADMIN_FEED_RECHECK_PATH = "/admin-api/operations/feed-recheck-requests" as const;

export type FeedRecheckResponseStatus = "accepted" | "already_pending" | "unavailable" | "not_found" | "rate_limited";

export type FeedRecheckResponse = {
  readonly status: FeedRecheckResponseStatus;
  readonly requestId: string | null;
  readonly target: {
    readonly displayId: string;
    readonly sourceHost: string | null;
  } | null;
  readonly queued: boolean;
  readonly cooldownSeconds: number | null;
  readonly message: string;
  readonly generatedAt: string;
};

export type FeedRecheckResult =
  | {
      readonly kind: FeedRecheckResponseStatus;
      readonly httpStatus: number;
      readonly response: FeedRecheckResponse;
    }
  | {
      readonly kind: "unauthenticated" | "forbidden" | "invalid_response" | "timeout";
      readonly httpStatus?: number;
      readonly message: string;
    };

export type RequestFeedRecheckOptions = {
  readonly actionRef: string;
  readonly csrfToken: string;
  readonly idempotencyKey?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const timeoutMs = 5000;
const actionRefPattern = /^feed_recheck_v1\.[A-Za-z0-9_-]{48,512}$/u;
const csrfPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const idempotencyPattern = /^[A-Za-z0-9_-]{16,80}$/u;
const displayIdPattern = /^feed_[a-f0-9]{10}$/u;
const requestIdPattern = /^recheck_[A-Za-z0-9_-]{12,64}$/u;
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

export const feedRecheckClientContract = {
  path: ADMIN_FEED_RECHECK_PATH,
  method: "POST",
  credentials: "same-origin",
  cache: "no-store",
  browserPersistence: false,
  csrfHeader: "X-Admin-CSRF",
  idempotencyHeader: "X-Admin-Idempotency-Key",
  customCredentialHeaders: false,
  queryForwarding: false,
  synchronousExternalFetch: false,
  arbitraryWrites: false
} as const;

export async function requestFeedRecheck(options: RequestFeedRecheckOptions): Promise<FeedRecheckResult> {
  if (!actionRefPattern.test(options.actionRef) || !csrfPattern.test(options.csrfToken)) {
    return {
      kind: "invalid_response",
      message: "Feed recheck request could not be validated before sending."
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  if (!idempotencyPattern.test(idempotencyKey)) {
    return {
      kind: "invalid_response",
      message: "Feed recheck idempotency key could not be generated."
    };
  }

  const abort = createRequestAbort(options);
  try {
    const response = await fetchImpl(ADMIN_FEED_RECHECK_PATH, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Admin-CSRF": options.csrfToken,
        "X-Admin-Idempotency-Key": idempotencyKey
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      body: JSON.stringify({
        actionRef: options.actionRef,
        reason: "operator_request"
      }),
      signal: abort.signal
    });

    return await parseFeedRecheckResponse(response);
  } catch (error) {
    if (abort.didTimeout()) {
      return {
        kind: "timeout",
        message: "Feed recheck request timed out."
      };
    }
    if (isAbortError(error)) {
      return {
        kind: "invalid_response",
        message: "Feed recheck request could not be verified."
      };
    }
    return {
      kind: "invalid_response",
      message: "Feed recheck API is unavailable."
    };
  } finally {
    abort.cleanup();
  }
}

export async function parseFeedRecheckResponse(response: Response): Promise<FeedRecheckResult> {
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

  if (response.status === 401) {
    return {
      kind: "unauthenticated",
      httpStatus: response.status,
      message: "Admin session expired. Sign in again before requesting a feed recheck."
    };
  }

  if (response.status === 403) {
    return {
      kind: "forbidden",
      httpStatus: response.status,
      message: "Feed recheck was blocked by the admin write-safety check."
    };
  }

  const parsed = parseFeedRecheckBody(body);
  if (parsed === undefined) return invalidResponse(response.status);

  if (
    (response.status === 200 || response.status === 202 || response.status === 404 || response.status === 409 || response.status === 429 || response.status === 501 || response.status === 502 || response.status === 503) &&
    isStatusAllowedForHttp(response.status, parsed.status)
  ) {
    return {
      kind: parsed.status,
      httpStatus: response.status,
      response: parsed
    };
  }

  return invalidResponse(response.status);
}

function parseFeedRecheckBody(value: unknown): FeedRecheckResponse | undefined {
  if (!isRecord(value)) return undefined;
  if (!isResponseStatus(value.status)) return undefined;
  if (value.requestId !== null && (typeof value.requestId !== "string" || !requestIdPattern.test(value.requestId))) {
    return undefined;
  }
  if (typeof value.queued !== "boolean") return undefined;
  if (value.cooldownSeconds !== null && !isCooldown(value.cooldownSeconds)) return undefined;
  if (typeof value.message !== "string" || !isSafeMessage(value.message)) return undefined;
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return undefined;
  if (value.target !== null && !isTarget(value.target)) return undefined;
  return value as FeedRecheckResponse;
}

function isStatusAllowedForHttp(httpStatus: number, status: FeedRecheckResponseStatus): boolean {
  if (httpStatus === 202) return status === "accepted";
  if (httpStatus === 200) return status === "already_pending" || status === "unavailable";
  if (httpStatus === 404) return status === "not_found";
  if (httpStatus === 409 || httpStatus === 429) return status === "rate_limited";
  return status === "unavailable";
}

function isTarget(value: unknown): value is FeedRecheckResponse["target"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayId === "string" &&
    displayIdPattern.test(value.displayId) &&
    (value.sourceHost === null || (typeof value.sourceHost === "string" && hostnamePattern.test(value.sourceHost)))
  );
}

function isResponseStatus(value: unknown): value is FeedRecheckResponseStatus {
  return value === "accepted" || value === "already_pending" || value === "unavailable" || value === "not_found" || value === "rate_limited";
}

function isCooldown(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 3600;
}

function isSafeMessage(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 180 && !unsafeTextPattern.test(normalized) && !/https?:\/\//iu.test(normalized);
}

function createIdempotencyKey(): string {
  const randomId = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (randomId !== undefined) return `recheck_${randomId.slice(0, 40)}`;
  return `recheck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

function invalidResponse(httpStatus?: number): FeedRecheckResult {
  return {
    kind: "invalid_response",
    httpStatus,
    message: "Feed recheck response could not be validated."
  };
}

function createRequestAbort(options: RequestFeedRecheckOptions): {
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
