export const ADMIN_SESSION_STATUS_PATH = "/admin-auth/session" as const;
export const ADMIN_SESSION_SENTINEL_HTTP_STATUS = 501;

export type AdminSessionStatusKind =
  | "unknown"
  | "checking"
  | "not_configured"
  | "auth_unavailable"
  | "invalid_response"
  | "timeout";

export type AdminSessionStatus = {
  readonly kind: AdminSessionStatusKind;
  readonly message: string;
  readonly httpStatus?: number;
};

export type FetchAdminSessionStatusOptions = {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ADMIN_SESSION_TIMEOUT_MS = 4000;
const sentinelMessage = "Admin authentication is not configured.";
const principalLikeKeys = new Set([
  "accessToken",
  "email",
  "jwt",
  "principal",
  "refreshToken",
  "role",
  "roles",
  "session",
  "sessionId",
  "tenant",
  "tenantId",
  "user",
  "userId"
]);

export const adminSessionClientContract = {
  path: ADMIN_SESSION_STATUS_PATH,
  method: "GET",
  credentials: "omit",
  cache: "no-store",
  redirectsAcceptedAsSuccess: false,
  browserPersistence: false,
  customCredentialHeaders: false,
  currentAuthenticatedStateImplemented: false
} as const;

export const unknownAdminSessionStatus: AdminSessionStatus = {
  kind: "unknown",
  message: "Admin authentication status has not been checked yet."
};

export const checkingAdminSessionStatus: AdminSessionStatus = {
  kind: "checking",
  message: "Checking admin authentication status."
};

export async function fetchAdminSessionStatus(
  options: FetchAdminSessionStatusOptions = {}
): Promise<AdminSessionStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);

  try {
    const response = await fetchImpl(ADMIN_SESSION_STATUS_PATH, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: abort.signal
    });

    return await parseAdminSessionResponse(response);
  } catch (error) {
    if (abort.didTimeout()) return timeoutStatus();
    if (isAbortError(error)) {
      return unavailableStatus("Admin authentication status could not be verified.");
    }
    return unavailableStatus("Admin authentication status is unavailable.");
  } finally {
    abort.cleanup();
  }
}

export async function parseAdminSessionResponse(response: Response): Promise<AdminSessionStatus> {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    return invalidStatus(response.status);
  }

  if (response.status !== ADMIN_SESSION_SENTINEL_HTTP_STATUS) {
    return invalidStatus(response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return invalidStatus(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return invalidStatus(response.status);
  }

  if (!isValidNotConfiguredSentinel(body)) {
    return invalidStatus(response.status);
  }

  return {
    kind: "not_configured",
    httpStatus: response.status,
    message: sentinelMessage
  };
}

export function isFailClosedAdminSessionStatus(status: AdminSessionStatus): true {
  void status;
  return true;
}

function isValidNotConfiguredSentinel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.status !== "not_configured") return false;
  if (value.authenticated !== false) return false;
  if (typeof value.message !== "string" || value.message.length === 0) return false;

  for (const key of Object.keys(value)) {
    if (isPrincipalLikeKey(key)) return false;
  }

  return true;
}

function isPrincipalLikeKey(key: string): boolean {
  return (
    principalLikeKeys.has(key) ||
    /^(?:access[_-]?token|email|jwt|principal|refresh[_-]?token|roles?|session[_-]?id|session|tenant[_-]?id|tenant|user[_-]?id|user)$/iu.test(key)
  );
}

function createRequestAbort(options: FetchAdminSessionStatusOptions): {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? ADMIN_SESSION_TIMEOUT_MS);

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

function unavailableStatus(message: string): AdminSessionStatus {
  return {
    kind: "auth_unavailable",
    message
  };
}

function invalidStatus(httpStatus?: number): AdminSessionStatus {
  return {
    kind: "invalid_response",
    httpStatus,
    message: "Admin authentication status could not be validated."
  };
}

function timeoutStatus(): AdminSessionStatus {
  return {
    kind: "timeout",
    message: "Admin authentication status timed out."
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
