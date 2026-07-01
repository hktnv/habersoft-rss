export const ADMIN_SESSION_STATUS_PATH = "/admin-auth/session" as const;
export const ADMIN_SESSION_LOGIN_PATH = "/admin-auth/login" as const;
export const ADMIN_SESSION_LOGOUT_PATH = "/admin-auth/logout" as const;
export const ADMIN_SESSION_SENTINEL_HTTP_STATUS = 501;

export type AdminPrincipal = {
  readonly kind: "single_admin";
  readonly displayName: "Admin";
};

export type AdminSessionStatus =
  | {
      readonly kind: "unknown" | "checking" | "not_configured" | "auth_unavailable" | "invalid_response" | "timeout";
      readonly message: string;
      readonly httpStatus?: number;
    }
  | {
      readonly kind: "unauthenticated";
      readonly message: string;
      readonly httpStatus?: number;
    }
  | {
      readonly kind: "authenticated";
      readonly message: string;
      readonly principal: AdminPrincipal;
      readonly expiresAt: string;
      readonly csrfToken: string;
      readonly httpStatus?: number;
    };

export type FetchAdminSessionStatusOptions = {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

export type LoginAdminSessionOptions = FetchAdminSessionStatusOptions & {
  readonly username: string;
  readonly password: string;
};

export type LogoutAdminSessionOptions = FetchAdminSessionStatusOptions;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ADMIN_SESSION_TIMEOUT_MS = 4000;
const sentinelMessage = "Admin authentication is not configured.";
const unauthenticatedMessage = "Admin authentication is required.";
const principalLikeKeys = new Set([
  "accessToken",
  "email",
  "jwt",
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
  loginPath: ADMIN_SESSION_LOGIN_PATH,
  logoutPath: ADMIN_SESSION_LOGOUT_PATH,
  methods: {
    session: "GET",
    login: "POST",
    logout: "POST"
  },
  credentials: "same-origin",
  cache: "no-store",
  redirectsAcceptedAsSuccess: false,
  browserPersistence: false,
  customCredentialHeaders: false,
  currentAuthenticatedStateImplemented: true
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
  return requestAdminSession({
    path: ADMIN_SESSION_STATUS_PATH,
    init: {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual"
    },
    options
  });
}

export async function loginAdminSession(options: LoginAdminSessionOptions): Promise<AdminSessionStatus> {
  return requestAdminSession({
    path: ADMIN_SESSION_LOGIN_PATH,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      body: JSON.stringify({
        username: options.username,
        password: options.password
      })
    },
    options
  });
}

export async function logoutAdminSession(options: LogoutAdminSessionOptions = {}): Promise<AdminSessionStatus> {
  return requestAdminSession({
    path: ADMIN_SESSION_LOGOUT_PATH,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json"
      },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual"
    },
    options
  });
}

export async function parseAdminSessionResponse(response: Response): Promise<AdminSessionStatus> {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
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

  if (response.status === ADMIN_SESSION_SENTINEL_HTTP_STATUS && isValidNotConfiguredSentinel(body)) {
    return notConfiguredStatus(response.status);
  }

  if ((response.status === 502 || response.status === 503 || response.status === 504) && isAuthUnavailableBody(body)) {
    return unavailableStatus("Admin authentication service is unavailable.", response.status);
  }

  if ((response.status === 200 || response.status === 401) && isValidUnauthenticatedBody(body)) {
    return unauthenticatedStatus(response.status);
  }

  if (response.status === 200) {
    const authenticated = parseAuthenticatedBody(body);
    if (authenticated !== undefined) {
      return {
        kind: "authenticated",
        httpStatus: response.status,
        message: "Admin session is authenticated.",
        principal: authenticated.principal,
        expiresAt: authenticated.expiresAt,
        csrfToken: authenticated.csrfToken
      };
    }
  }

  return invalidStatus(response.status);
}

export function isFailClosedAdminSessionStatus(status: AdminSessionStatus): boolean {
  return status.kind !== "authenticated";
}

async function requestAdminSession({
  path,
  init,
  options
}: {
  readonly path: string;
  readonly init: RequestInit;
  readonly options: FetchAdminSessionStatusOptions;
}): Promise<AdminSessionStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const abort = createRequestAbort(options);

  try {
    const response = await fetchImpl(path, {
      ...init,
      signal: abort.signal
    });

    return await parseAdminSessionResponse(response);
  } catch (error) {
    if (abort.didTimeout()) return timeoutStatus();
    if (isAbortError(error)) {
      return unavailableStatus("Admin authentication request could not be verified.");
    }
    return unavailableStatus("Admin authentication service is unavailable.");
  } finally {
    abort.cleanup();
  }
}

function isValidNotConfiguredSentinel(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const configured = value.configured;
  if (configured !== undefined && configured !== false) return false;
  if (value.status !== "not_configured" && value.reason !== "not_configured") return false;
  if (value.authenticated !== false) return false;
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length === 0)) return false;

  for (const key of Object.keys(value)) {
    if (isPrincipalLikeKey(key)) return false;
  }

  return true;
}

function isValidUnauthenticatedBody(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.configured !== true) return false;
  if (value.authenticated !== false) return false;
  if (value.reason !== "unauthenticated" && value.reason !== "logged_out") return false;

  for (const key of Object.keys(value)) {
    if (isPrincipalLikeKey(key)) return false;
  }

  return true;
}

function parseAuthenticatedBody(value: unknown):
  | {
      readonly principal: AdminPrincipal;
      readonly expiresAt: string;
      readonly csrfToken: string;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  if (value.configured !== true || value.authenticated !== true) return undefined;
  if (typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt))) return undefined;
  if (typeof value.csrfToken !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(value.csrfToken)) return undefined;
  if (!isRecord(value.principal)) return undefined;
  if (value.principal.kind !== "single_admin" || value.principal.displayName !== "Admin") return undefined;

  for (const key of Object.keys(value)) {
    if (key !== "configured" && key !== "authenticated" && key !== "principal" && key !== "expiresAt" && key !== "csrfToken") {
      return undefined;
    }
  }

  for (const key of Object.keys(value.principal)) {
    if (key !== "kind" && key !== "displayName") return undefined;
  }

  return {
    principal: {
      kind: "single_admin",
      displayName: "Admin"
    },
    expiresAt: value.expiresAt,
    csrfToken: value.csrfToken
  };
}

function isAuthUnavailableBody(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.authenticated !== false) return false;
  return value.reason === "auth_unavailable" || value.status === "auth_unavailable";
}

function isPrincipalLikeKey(key: string): boolean {
  return (
    principalLikeKeys.has(key) ||
    /^(?:access[_-]?token|email|jwt|refresh[_-]?token|roles?|session[_-]?id|session|tenant[_-]?id|tenant|user[_-]?id|user)$/iu.test(key)
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

function notConfiguredStatus(httpStatus?: number): AdminSessionStatus {
  return {
    kind: "not_configured",
    httpStatus,
    message: sentinelMessage
  };
}

function unauthenticatedStatus(httpStatus?: number): AdminSessionStatus {
  return {
    kind: "unauthenticated",
    httpStatus,
    message: unauthenticatedMessage
  };
}

function unavailableStatus(message: string, httpStatus?: number): AdminSessionStatus {
  return {
    kind: "auth_unavailable",
    httpStatus,
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
    message: "Admin authentication request timed out."
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
