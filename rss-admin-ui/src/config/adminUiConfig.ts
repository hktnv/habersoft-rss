const DEFAULT_ENVIRONMENT_NAME = "local";
const SENSITIVE_AGENT_SECRET_PATTERN = new RegExp(["AGENT", "KEY"].join("_"), "iu");
const UNSAFE_ENVIRONMENT_LABEL_PATTERNS = [
  SENSITIVE_AGENT_SECRET_PATTERN,
  /Authorization/iu,
  /Bearer/iu,
  /https?:\/\//iu,
  /[?&#=]/u
];

declare global {
  interface Window {
    __RSS_ADMIN_UI_CONFIG__?: {
      environmentName?: string;
    };
  }
}

export type AdminUiConfig = {
  environmentName: string;
};

export function resolveAdminUiConfig(): AdminUiConfig {
  const runtimeConfig = typeof window === "undefined" ? undefined : window.__RSS_ADMIN_UI_CONFIG__;

  return {
    environmentName: normalizeEnvironmentName(runtimeConfig?.environmentName ?? import.meta.env.MODE ?? DEFAULT_ENVIRONMENT_NAME)
  };
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
  defaultEnvironmentName: DEFAULT_ENVIRONMENT_NAME,
  readOnlyHealthDashboardImplemented: true,
  sameOriginHealthTransport: true,
  clientVisibleApiBaseUrl: false,
  publicHealthObservationOnly: true,
  writesImplemented: false,
  agentKeyAllowed: false,
  tokenPersistenceImplemented: false
} as const;
