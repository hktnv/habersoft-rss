export type DependencyState = "up" | "down";

export type LiveHealthPayload = {
  readonly status: "live";
};

export type ReadyHealthPayload = {
  readonly status: "ready" | "not_ready";
  readonly dependencies: {
    readonly postgres: DependencyState;
    readonly redis: DependencyState;
    readonly tenantAuth: DependencyState;
  };
};

export type HealthEndpointName = "live" | "ready";

export type SafeHealthErrorCode =
  | "http_status_unaccepted"
  | "invalid_json"
  | "invalid_payload"
  | "request_aborted"
  | "request_failed"
  | "request_timeout";

export type SafeHealthError = {
  readonly code: SafeHealthErrorCode;
  readonly message: string;
};

export type HealthEndpointObservation<TPayload> =
  | {
      readonly ok: true;
      readonly endpoint: HealthEndpointName;
      readonly httpStatus: number;
      readonly payload: TPayload;
    }
  | {
      readonly ok: false;
      readonly endpoint: HealthEndpointName;
      readonly httpStatus?: number;
      readonly error: SafeHealthError;
    };

export type ObservedHealthState = "healthy" | "degraded" | "unavailable" | "partial";

export type HealthObservation = {
  readonly observedAt: string;
  readonly overall: ObservedHealthState;
  readonly live: HealthEndpointObservation<LiveHealthPayload>;
  readonly ready: HealthEndpointObservation<ReadyHealthPayload>;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ObserveBackendHealthOptions = {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
};

const HEALTH_CLIENT_TIMEOUT_MS = 5000;

export function buildHealthUrl(apiBaseUrl: string, path: "/health/live" | "/health/ready"): string {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  return new URL(path.replace(/^\/+/u, ""), base).toString();
}

export async function observeBackendHealth(
  apiBaseUrl: string,
  options: ObserveBackendHealthOptions = {}
): Promise<HealthObservation> {
  const [live, ready] = await Promise.all([
    requestLiveHealth(apiBaseUrl, options),
    requestReadyHealth(apiBaseUrl, options)
  ]);

  return {
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    overall: classifyObservation(live, ready),
    live,
    ready
  };
}

export const healthClientContract = {
  endpoints: ["/health/live", "/health/ready"],
  method: "GET",
  credentials: "omit",
  cache: "no-store",
  persistence: false,
  authorizationHeader: false,
  agentKeyHeader: false,
  writes: false
} as const;

async function requestLiveHealth(
  apiBaseUrl: string,
  options: ObserveBackendHealthOptions
): Promise<HealthEndpointObservation<LiveHealthPayload>> {
  return requestJsonEndpoint({
    apiBaseUrl,
    endpoint: "live",
    path: "/health/live",
    acceptsHttpStatus: (status) => status === 200,
    validatePayload: parseLiveHealthPayload,
    options
  });
}

async function requestReadyHealth(
  apiBaseUrl: string,
  options: ObserveBackendHealthOptions
): Promise<HealthEndpointObservation<ReadyHealthPayload>> {
  const result = await requestJsonEndpoint({
    apiBaseUrl,
    endpoint: "ready",
    path: "/health/ready",
    acceptsHttpStatus: (status) => status === 200 || status === 503,
    validatePayload: parseReadyHealthPayload,
    options
  });

  if (!result.ok) return result;

  const statusMatchesPayload =
    (result.httpStatus === 200 && result.payload.status === "ready") ||
    (result.httpStatus === 503 && result.payload.status === "not_ready");

  if (!statusMatchesPayload) {
    return {
      ok: false,
      endpoint: "ready",
      httpStatus: result.httpStatus,
      error: safeError(
        "invalid_payload",
        "The readiness response did not match the expected public health contract."
      )
    };
  }

  return result;
}

type RequestJsonEndpointInput<TPayload> = {
  readonly apiBaseUrl: string;
  readonly endpoint: HealthEndpointName;
  readonly path: "/health/live" | "/health/ready";
  readonly acceptsHttpStatus: (status: number) => boolean;
  readonly validatePayload: (value: unknown) => TPayload | undefined;
  readonly options: ObserveBackendHealthOptions;
};

async function requestJsonEndpoint<TPayload>({
  apiBaseUrl,
  endpoint,
  path,
  acceptsHttpStatus,
  validatePayload,
  options
}: RequestJsonEndpointInput<TPayload>): Promise<HealthEndpointObservation<TPayload>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);

  try {
    const response = await fetchImpl(buildHealthUrl(apiBaseUrl, path), {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "omit",
      cache: "no-store",
      signal: abort.signal
    });

    if (!acceptsHttpStatus(response.status)) {
      return {
        ok: false,
        endpoint,
        httpStatus: response.status,
        error: safeError("http_status_unaccepted", "The health endpoint returned an unexpected HTTP status.")
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        endpoint,
        httpStatus: response.status,
        error: safeError("invalid_json", "The health endpoint did not return valid JSON.")
      };
    }

    const payload = validatePayload(body);
    if (payload === undefined) {
      return {
        ok: false,
        endpoint,
        httpStatus: response.status,
        error: safeError("invalid_payload", "The health response did not match the expected public contract.")
      };
    }

    return {
      ok: true,
      endpoint,
      httpStatus: response.status,
      payload
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      error: normalizeRequestError(error, abort.didTimeout())
    };
  } finally {
    abort.cleanup();
  }
}

function createRequestAbort(options: ObserveBackendHealthOptions): {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? HEALTH_CLIENT_TIMEOUT_MS);

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

function classifyObservation(
  live: HealthEndpointObservation<LiveHealthPayload>,
  ready: HealthEndpointObservation<ReadyHealthPayload>
): ObservedHealthState {
  if (!live.ok) return "unavailable";
  if (!ready.ok) return "partial";

  const dependencies = Object.values(ready.payload.dependencies);
  if (ready.payload.status === "ready" && dependencies.every((state) => state === "up")) {
    return "healthy";
  }

  return "degraded";
}

function parseLiveHealthPayload(value: unknown): LiveHealthPayload | undefined {
  if (!isRecord(value) || value.status !== "live") return undefined;
  return { status: "live" };
}

function parseReadyHealthPayload(value: unknown): ReadyHealthPayload | undefined {
  if (!isRecord(value) || (value.status !== "ready" && value.status !== "not_ready")) return undefined;
  const dependencies = value.dependencies;
  if (!isRecord(dependencies)) return undefined;

  const postgres = parseDependencyState(dependencies.postgres);
  const redis = parseDependencyState(dependencies.redis);
  const tenantAuth = parseDependencyState(dependencies.tenantAuth);
  if (postgres === undefined || redis === undefined || tenantAuth === undefined) return undefined;

  return {
    status: value.status,
    dependencies: {
      postgres,
      redis,
      tenantAuth
    }
  };
}

function parseDependencyState(value: unknown): DependencyState | undefined {
  return value === "up" || value === "down" ? value : undefined;
}

function normalizeRequestError(error: unknown, didTimeout: boolean): SafeHealthError {
  if (didTimeout) {
    return safeError("request_timeout", "The health request timed out before a safe observation completed.");
  }

  if (isAbortError(error)) {
    return safeError("request_aborted", "The health request was cancelled before completion.");
  }

  return safeError("request_failed", "The health request could not be completed.");
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function safeError(code: SafeHealthErrorCode, message: string): SafeHealthError {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
