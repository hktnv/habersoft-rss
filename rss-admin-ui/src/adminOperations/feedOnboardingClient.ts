export const ADMIN_FEED_ONBOARDING_PATH = "/admin-api/operations/feed-onboarding-requests" as const;

export type FeedOnboardingResponseStatus = "created" | "already_exists" | "unavailable" | "rate_limited";

export type FeedOnboardingResponse = {
  readonly status: FeedOnboardingResponseStatus;
  readonly requestRef: string | null;
  readonly feed: {
    readonly displayId: string;
    readonly sourceHost: string;
    readonly state: "pending" | "active" | "disabled";
    readonly eligibleForRecheck: boolean;
  } | null;
  readonly nextSteps: readonly string[];
  readonly message: string;
  readonly generatedAt: string;
};

export type FeedOnboardingResult =
  | {
      readonly kind: FeedOnboardingResponseStatus;
      readonly httpStatus: number;
      readonly response: FeedOnboardingResponse;
    }
  | {
      readonly kind: "invalid_request" | "unauthenticated" | "forbidden" | "invalid_response" | "timeout";
      readonly httpStatus?: number;
      readonly message: string;
    };

export type RequestFeedOnboardingOptions = {
  readonly feedUrl: string;
  readonly label?: string;
  readonly csrfToken: string;
  readonly idempotencyKey?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const timeoutMs = 5000;
const csrfPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const idempotencyPattern = /^[A-Za-z0-9_-]{16,80}$/u;
const displayIdPattern = /^feed_[a-f0-9]{10}$/u;
const requestRefPattern = /^onboard_[A-Za-z0-9_-]{12,64}$/u;
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
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

export const feedOnboardingClientContract = {
  path: ADMIN_FEED_ONBOARDING_PATH,
  method: "POST",
  credentials: "same-origin",
  cache: "no-store",
  browserPersistence: false,
  csrfHeader: "X-Admin-CSRF",
  idempotencyHeader: "X-Admin-Idempotency-Key",
  customCredentialHeaders: false,
  queryForwarding: false,
  synchronousExternalFetch: false,
  arbitraryWrites: false,
  rawUrlInEvidence: false
} as const;

export async function requestFeedOnboarding(options: RequestFeedOnboardingOptions): Promise<FeedOnboardingResult> {
  const request = parseFeedOnboardingRequest(options.feedUrl, options.label);
  if (request === undefined) {
    return {
      kind: "invalid_request",
      message: "Feed URL was rejected by the admin safety checks."
    };
  }

  if (!csrfPattern.test(options.csrfToken)) {
    return {
      kind: "invalid_request",
      message: "Admin session expired. Sign in again before onboarding a feed."
    };
  }

  const idempotencyKey = options.idempotencyKey ?? createIdempotencyKey();
  if (!idempotencyPattern.test(idempotencyKey)) {
    return {
      kind: "invalid_request",
      message: "Feed onboarding idempotency key could not be generated."
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);
  try {
    const response = await fetchImpl(ADMIN_FEED_ONBOARDING_PATH, {
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
      body: JSON.stringify(request),
      signal: abort.signal
    });

    return await parseFeedOnboardingResponse(response);
  } catch (error) {
    if (abort.didTimeout()) {
      return {
        kind: "timeout",
        message: "Feed onboarding request timed out."
      };
    }
    if (isAbortError(error)) {
      return {
        kind: "invalid_response",
        message: "Feed onboarding request could not be verified."
      };
    }
    return {
      kind: "invalid_response",
      message: "Feed onboarding API is unavailable."
    };
  } finally {
    abort.cleanup();
  }
}

export async function parseFeedOnboardingResponse(response: Response): Promise<FeedOnboardingResult> {
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
      message: "Admin session expired. Sign in again before onboarding a feed."
    };
  }

  if (response.status === 403) {
    return {
      kind: "forbidden",
      httpStatus: response.status,
      message: "Feed onboarding was blocked by the admin write-safety check."
    };
  }

  const parsed = parseFeedOnboardingBody(body);
  if (parsed === undefined) return invalidResponse(response.status);

  if (
    (response.status === 200 ||
      response.status === 201 ||
      response.status === 400 ||
      response.status === 409 ||
      response.status === 422 ||
      response.status === 429 ||
      response.status === 501 ||
      response.status === 502 ||
      response.status === 503) &&
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

function parseFeedOnboardingRequest(feedUrl: string, label: string | undefined): { readonly feedUrl: string; readonly label?: string } | undefined {
  const canonicalUrl = parseFeedUrl(feedUrl);
  if (canonicalUrl === undefined) return undefined;

  const parsedLabel = parseLabel(label);
  if (parsedLabel === undefined) return undefined;

  return parsedLabel === null ? { feedUrl: canonicalUrl } : { feedUrl: canonicalUrl, label: parsedLabel };
}

function parseFeedUrl(value: string): string | undefined {
  if (value.length < 12 || value.length > 2048 || value.trim() !== value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  if (parsed.hash !== "") return undefined;
  const sourceHost = safeSourceHost(parsed.hostname);
  if (sourceHost === null) return undefined;
  parsed.protocol = "https:";
  parsed.hostname = sourceHost;
  parsed.hash = "";
  const canonical = parsed.toString();
  return canonical.length <= 2048 && !canonical.includes("#") ? canonical : undefined;
}

function parseLabel(value: string | undefined): string | null | undefined {
  if (value === undefined) return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") return null;
  if (normalized.length > 80 || unsafeTextPattern.test(normalized) || /https?:\/\//iu.test(normalized)) return undefined;
  return normalized;
}

function parseFeedOnboardingBody(value: unknown): FeedOnboardingResponse | undefined {
  if (!isRecord(value)) return undefined;
  if (!isResponseStatus(value.status)) return undefined;
  if (value.requestRef !== null && (typeof value.requestRef !== "string" || !requestRefPattern.test(value.requestRef))) {
    return undefined;
  }
  if (value.feed !== null && !isFeed(value.feed)) return undefined;
  if (!Array.isArray(value.nextSteps) || value.nextSteps.length > 8 || !value.nextSteps.every(isSafeMessage)) return undefined;
  if (typeof value.message !== "string" || !isSafeMessage(value.message)) return undefined;
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return undefined;
  return value as FeedOnboardingResponse;
}

function isStatusAllowedForHttp(httpStatus: number, status: FeedOnboardingResponseStatus): boolean {
  if (httpStatus === 201) return status === "created";
  if (httpStatus === 200) return status === "already_exists" || status === "created";
  if (httpStatus === 409 || httpStatus === 429) return status === "rate_limited" || status === "unavailable";
  return status === "unavailable";
}

function isFeed(value: unknown): value is FeedOnboardingResponse["feed"] {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayId === "string" &&
    displayIdPattern.test(value.displayId) &&
    typeof value.sourceHost === "string" &&
    safeSourceHost(value.sourceHost) !== null &&
    (value.state === "pending" || value.state === "active" || value.state === "disabled") &&
    typeof value.eligibleForRecheck === "boolean"
  );
}

function isResponseStatus(value: unknown): value is FeedOnboardingResponseStatus {
  return value === "created" || value === "already_exists" || value === "unavailable" || value === "rate_limited";
}

function safeSourceHost(value: string): string | null {
  const hostname = value.toLowerCase().replace(/\.$/u, "");
  if (!hostnamePattern.test(hostname)) return null;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return null;
  if (hostname === "host.docker.internal" || hostname.endsWith(".docker.internal")) return null;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (hostname.endsWith(".lan") || hostname.endsWith(".home") || hostname.endsWith(".corp")) return null;
  return hostname.includes("_") || hostname.includes(":") || hostname.includes("/") || hostname.includes("?") ? null : hostname;
}

function isSafeMessage(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 180 && !unsafeTextPattern.test(normalized) && !/https?:\/\//iu.test(normalized);
}

function createIdempotencyKey(): string {
  const randomId = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (randomId !== undefined) return `onboard_${randomId.slice(0, 40)}`;
  return `onboard_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
}

function invalidResponse(httpStatus?: number): FeedOnboardingResult {
  return {
    kind: "invalid_response",
    httpStatus,
    message: "Feed onboarding response could not be validated."
  };
}

function createRequestAbort(options: RequestFeedOnboardingOptions): {
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
