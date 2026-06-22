import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const productionIdentifiers = [
  "rss.habersoft.com",
  "auth.habersoft.com",
  "main-service-production",
  "tenant_rate_limit:production",
  "main_service_production"
];

export const REQUIRED_ENV_KEYS = Object.freeze([
  "LOG_LEVEL",
  "API_HOST_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "DATABASE_URL",
  "REDIS_URL",
  "TENANT_AUTH_JWKS_URL",
  "TENANT_RATE_LIMIT_MAX_REQUESTS",
  "TENANT_RATE_LIMIT_WINDOW_SECONDS",
  "TENANT_RATE_LIMIT_REDIS_PREFIX",
  "TENANT_RATE_LIMIT_KEY_SECRET",
  "AGENT_KEY",
  "CHECKED_AT_MAX_FUTURE_SKEW_SECONDS",
  "CHECKED_AT_MAX_AGE_SECONDS",
  "ENTRY_RETENTION_DAYS",
  "ENTRY_MAX_PER_FEED",
  "ENTRY_DETAIL_RETENTION_DAYS",
  "ENTRY_DETAIL_MAX_PER_FEED",
  "BULLMQ_PREFIX",
  "MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS",
  "MAINTENANCE_COMPLETED_JOB_MAX_COUNT",
  "MAINTENANCE_FAILED_JOB_RETENTION_SECONDS",
  "MAINTENANCE_FAILED_JOB_MAX_COUNT",
  "NODE_ENV"
]);

export const LEGACY_RUNTIME_IMAGE_ENV_KEY = "MAIN_SERVICE_IMAGE";
export const ALLOWED_ENV_KEYS = Object.freeze([
  LEGACY_RUNTIME_IMAGE_ENV_KEY,
  ...REQUIRED_ENV_KEYS
]);

const numericKeys = new Set([
  "API_HOST_PORT",
  "TENANT_RATE_LIMIT_MAX_REQUESTS",
  "TENANT_RATE_LIMIT_WINDOW_SECONDS",
  "CHECKED_AT_MAX_FUTURE_SKEW_SECONDS",
  "CHECKED_AT_MAX_AGE_SECONDS",
  "ENTRY_RETENTION_DAYS",
  "ENTRY_MAX_PER_FEED",
  "ENTRY_DETAIL_RETENTION_DAYS",
  "ENTRY_DETAIL_MAX_PER_FEED",
  "MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS",
  "MAINTENANCE_COMPLETED_JOB_MAX_COUNT",
  "MAINTENANCE_FAILED_JOB_RETENTION_SECONDS",
  "MAINTENANCE_FAILED_JOB_MAX_COUNT"
]);

export const INCOMPLETE_IMAGE_MARKER = "PACKAGE_NOT_SELECTED__REPLACE_WITH_DIGEST_PINNED_CANDIDATE_IMAGE";

export function loadProductionTemplate(file = "deploy/production/production.env.template") {
  return parseEnvText(readFileSync(file, "utf8"));
}

export function stagingEnvFromTemplate(target, secrets = {}) {
  const env = loadProductionTemplate();
  const postgresPassword = secrets.postgresPassword ?? "CHANGE_ME_STAGING_POSTGRES_PASSWORD_MINIMUM_32_BYTES";
  const rateLimitSecret = secrets.rateLimitSecret ?? "CHANGE_ME_STAGING_RATE_LIMIT_SECRET_MINIMUM_32_BYTES";
  const agentKey = secrets.agentKey ?? "CHANGE_ME_STAGING_AGENT_KEY_MINIMUM_32_BYTES";
  const postgresUser = "main_service_staging";
  const postgresDb = "main_service_staging";

  return {
    ...env,
    API_HOST_PORT: String(target.api_host_port),
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgresql://${postgresUser}:${encodeURIComponent(postgresPassword)}@postgres:5432/${postgresDb}?schema=public`,
    TENANT_AUTH_JWKS_URL: "https://auth-staging.operator.example/.well-known/jwks.json",
    TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:staging",
    TENANT_RATE_LIMIT_KEY_SECRET: rateLimitSecret,
    AGENT_KEY: agentKey,
    BULLMQ_PREFIX: "main-service-staging",
    NODE_ENV: "production"
  };
}

export function formatEnv(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function removeRuntimeImageFromEnv(env) {
  const { [LEGACY_RUNTIME_IMAGE_ENV_KEY]: _ignored, ...sharedEnv } = env;
  return sharedEnv;
}

export function loadEnvFile(file) {
  if (file === undefined || !existsSync(path.resolve(file))) {
    throw new Error("env-file must exist");
  }
  const stat = statSync(path.resolve(file));
  if (!stat.isFile() || stat.size === 0) {
    throw new Error("env-file must be a non-empty file");
  }
  return parseEnvText(readFileSync(path.resolve(file), "utf8"));
}

export function validateStagingEnv(env, target, mode = "operator-input") {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  for (const key of REQUIRED_ENV_KEYS) {
    assert(env[key] !== undefined && env[key].trim() !== "", `${key} is required`);
  }
  for (const key of Object.keys(env)) {
    assert(ALLOWED_ENV_KEYS.includes(key), `unknown env key ${key}`);
  }

  assert(env.NODE_ENV === "production", "NODE_ENV must be production");
  assert(env.API_HOST_PORT === String(target.api_host_port), "API_HOST_PORT must match target api_host_port");
  assert(env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "info" || env.LOG_LEVEL === "warn" || env.LOG_LEVEL === "error", "LOG_LEVEL is invalid");
  assert(env.POSTGRES_USER?.toLowerCase().includes("staging"), "POSTGRES_USER must be staging-specific");
  assert(env.POSTGRES_DB?.toLowerCase().includes("staging"), "POSTGRES_DB must be staging-specific");
  assert(env.TENANT_RATE_LIMIT_REDIS_PREFIX?.toLowerCase().includes("staging"), "TENANT_RATE_LIMIT_REDIS_PREFIX must be staging-specific");
  assert(env.BULLMQ_PREFIX?.toLowerCase().includes("staging"), "BULLMQ_PREFIX must be staging-specific");

  for (const key of numericKeys) {
    const value = Number(env[key]);
    assert(Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER, `${key} must be a positive integer`);
  }

  validateComposeUrls(env, assert);
  requireSecret("POSTGRES_PASSWORD", env.POSTGRES_PASSWORD, 16, assert);
  requireSecret("TENANT_RATE_LIMIT_KEY_SECRET", env.TENANT_RATE_LIMIT_KEY_SECRET, 32, assert);
  requireSecret("AGENT_KEY", env.AGENT_KEY, 32, assert);

  const legacyImagePresent = env[LEGACY_RUNTIME_IMAGE_ENV_KEY] !== undefined;
  const imageIdentityReady = false;
  if (legacyImagePresent) {
    assert(String(env[LEGACY_RUNTIME_IMAGE_ENV_KEY]).trim() !== "", "legacy MAIN_SERVICE_IMAGE must not be empty when present");
  }

  for (const [key, value] of Object.entries(env)) {
    const lower = String(value).toLowerCase();
    for (const identifier of productionIdentifiers) {
      assert(!lower.includes(identifier), `${key} must not contain production identifier`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  return {
    envSchemaValid: true,
    secretsPresent: true,
    imageIdentityReady,
    legacyImageFieldPresent: legacyImagePresent,
    packageImageRequired: mode === "deployment-ready"
  };
}

export function assertEnvFileMode(file) {
  if (process.platform === "win32") {
    return { posixModeEnforced: false, note: "windows-posix-mode-not-guaranteed" };
  }
  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("staging env file must not be readable by group/other on POSIX");
  }
  return { posixModeEnforced: true, mode: mode.toString(8) };
}

function parseEnvText(text) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of stripBom(text).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`invalid env line for key ${redactedLineName(line)}`);
    }
    const key = line.slice(0, separator);
    if (seen.has(key)) {
      throw new Error(`duplicate env key ${key}`);
    }
    seen.add(key);
    entries.push([key, line.slice(separator + 1)]);
  }
  return Object.fromEntries(entries);
}

function validateComposeUrls(env, assert) {
  try {
    const parsed = new URL(env.DATABASE_URL);
    assert(parsed.protocol === "postgresql:", "DATABASE_URL must use postgresql");
    assert(parsed.hostname === "postgres", "DATABASE_URL must target postgres on the Compose network");
    assert(parsed.username === env.POSTGRES_USER, "DATABASE_URL username must match POSTGRES_USER");
    assert(parsed.pathname === `/${env.POSTGRES_DB}`, "DATABASE_URL database must match POSTGRES_DB");
  } catch {
    assert(false, "DATABASE_URL must be a valid PostgreSQL URL");
  }

  try {
    const parsed = new URL(env.REDIS_URL);
    assert(parsed.protocol === "redis:" || parsed.protocol === "rediss:", "REDIS_URL uses unsupported protocol");
    assert(parsed.hostname === "redis", "REDIS_URL must target redis on the Compose network");
  } catch {
    assert(false, "REDIS_URL must be a valid Redis URL");
  }

  try {
    const parsed = new URL(env.TENANT_AUTH_JWKS_URL);
    const localFixtures = new Set(["localhost", "127.0.0.1", "::1", "tenant-auth-jwks-fixture"]);
    assert(parsed.protocol === "https:", "TENANT_AUTH_JWKS_URL must use HTTPS");
    assert(!localFixtures.has(parsed.hostname), "TENANT_AUTH_JWKS_URL must not target a local fixture");
  } catch {
    assert(false, "TENANT_AUTH_JWKS_URL must be a valid URL");
  }
}

function requireSecret(name, value, minBytes, assert) {
  assert(Buffer.byteLength(value ?? "", "utf8") >= minBytes, `${name} must be at least ${minBytes} UTF-8 bytes`);
  assert(!/replace_with|local_only|change_me|example|placeholder|<|>/iu.test(value ?? ""), `${name} must be explicit and not a placeholder`);
  assert(String(value ?? "").trim() === value, `${name} must not include leading or trailing whitespace`);
}

function isImmutableImageReference(value) {
  return typeof value === "string"
    && !value.endsWith(":latest")
    && (/@sha256:[a-f0-9]{64}$/u.test(value) || /^sha256:[a-f0-9]{64}$/u.test(value));
}

function redactedLineName(line) {
  const separator = line.indexOf("=");
  return separator === -1 ? "[invalid]" : line.slice(0, separator);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
