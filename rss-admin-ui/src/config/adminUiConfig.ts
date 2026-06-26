const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:3000";
const DEFAULT_ENVIRONMENT_NAME = "local";
const PRIVATE_HOST_PATTERNS = [/habersoft-auth/iu, /EVO-MRDM/iu, /192\.168\./u, /10\.\d{1,3}\./u, /172\.(1[6-9]|2\d|3[01])\./u];
const UNSAFE_ENVIRONMENT_LABEL_PATTERNS = [/AGENT_KEY/iu, /Authorization/iu, /Bearer/iu, /https?:\/\//iu, /[?&#=]/u];

declare global {
  interface Window {
    __RSS_ADMIN_UI_CONFIG__?: {
      apiBaseUrl?: string;
      environmentName?: string;
    };
  }
}

export type AdminUiConfig = {
  apiBaseUrl: string;
  environmentName: string;
};

export function resolveAdminUiConfig(): AdminUiConfig {
  const runtimeConfig = typeof window === "undefined" ? undefined : window.__RSS_ADMIN_UI_CONFIG__;
  const rawApiBaseUrl =
    runtimeConfig?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? DEFAULT_LOCAL_API_BASE_URL;
  const apiBaseUrl = normalizeApiBaseUrl(rawApiBaseUrl);

  assertPublicSafeConfig(apiBaseUrl);

  return {
    apiBaseUrl,
    environmentName: normalizeEnvironmentName(runtimeConfig?.environmentName ?? import.meta.env.MODE ?? DEFAULT_ENVIRONMENT_NAME)
  };
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return DEFAULT_LOCAL_API_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("API base URL must be an absolute HTTP(S) URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("API base URL must use HTTP or HTTPS");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function assertPublicSafeConfig(apiBaseUrl: string): void {
  if (apiBaseUrl.includes("AGENT_KEY")) {
    throw new Error("Admin UI config must not reference Agent credentials");
  }
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(apiBaseUrl)) {
      throw new Error("Admin UI config must not embed a private workstation or network host");
    }
  }
}

export function normalizeEnvironmentName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return DEFAULT_ENVIRONMENT_NAME;
  if (trimmed.length > 64) {
    throw new Error("Admin UI environment label must be 64 characters or fewer");
  }
  if (hasControlCharacter(trimmed)) {
    throw new Error("Admin UI environment label must not contain control characters");
  }
  for (const pattern of UNSAFE_ENVIRONMENT_LABEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error("Admin UI environment label must be a non-secret display label");
    }
  }
  return trimmed;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return true;
  }
  return false;
}

export const adminUiConfigContract = {
  defaultLocalApiBaseUrl: DEFAULT_LOCAL_API_BASE_URL,
  defaultEnvironmentName: DEFAULT_ENVIRONMENT_NAME,
  readOnlyHealthDashboardImplemented: true,
  publicHealthObservationOnly: true,
  writesImplemented: false,
  agentKeyAllowed: false,
  tokenPersistenceImplemented: false
} as const;
