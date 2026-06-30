import { pbkdf2Sync } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = "deploy/production/compose.yaml";
const adminAuthEnvNames = [
  "ADMIN_UI_AUTH_MODE",
  "ADMIN_UI_ADMIN_USERNAME",
  "ADMIN_UI_ADMIN_PASSWORD_HASH",
  "ADMIN_UI_SESSION_SECRET",
  "ADMIN_UI_SESSION_TTL_SECONDS",
  "ADMIN_UI_SESSION_COOKIE_NAME",
  "ADMIN_UI_SESSION_COOKIE_SECURE",
  "ADMIN_UI_SESSION_REDIS_PREFIX"
];

rejectCredentialArgs(process.argv.slice(2));

const disabledConfig = renderCompose({});
const disabledApiEnv = serviceEnvironment(disabledConfig, "main-service-api");
const disabledWorkerEnv = serviceEnvironment(disabledConfig, "main-service-worker");
assertAdminAuthNamesPresent(disabledApiEnv, "main-service-api disabled default render");
assertNoAdminAuthNames(disabledWorkerEnv, "main-service-worker disabled default render");
assert(disabledApiEnv.ADMIN_UI_AUTH_MODE === "disabled", "API admin-auth mode must default to disabled");
assert(disabledApiEnv.ADMIN_UI_SESSION_COOKIE_SECURE === "true", "API admin-auth secure cookie must default true");

const singleAdminConfig = renderCompose(syntheticAdminAuthEnv());
const singleAdminApiEnv = serviceEnvironment(singleAdminConfig, "main-service-api");
const singleAdminWorkerEnv = serviceEnvironment(singleAdminConfig, "main-service-worker");
assertAdminAuthNamesPresent(singleAdminApiEnv, "main-service-api single_admin render");
assertNoAdminAuthNames(singleAdminWorkerEnv, "main-service-worker single_admin render");
assert(singleAdminApiEnv.ADMIN_UI_AUTH_MODE === "single_admin", "API admin-auth mode must render single_admin when supplied");
assert(singleAdminApiEnv.ADMIN_UI_SESSION_COOKIE_SECURE === "true", "API admin-auth secure cookie must remain true in production");

writeJson({
  status: "backend-admin-auth-compose-wiring-verify-ok",
  compose_file: composeFile,
  api_admin_auth_env: "wired",
  worker_admin_auth_env: "absent_by_design",
  disabled_default: "ADMIN_AUTH_DISABLED",
  single_admin_render: "ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT",
  output: "redacted"
});

function renderCompose(adminAuthEnv) {
  const result = spawnSync("docker", ["compose", "-f", composeFile, "config", "--format", "json"], {
    cwd: backendRoot,
    env: {
      ...scrubbedProcessEnv(),
      ...baseSyntheticEnv(),
      ...adminAuthEnv
    },
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });

  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr || result.error?.message || "docker compose config failed\n");
    process.exit(result.status ?? 1);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    process.stderr.write(`failed to parse docker compose JSON output: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

function serviceEnvironment(config, serviceName) {
  const service = config.services?.[serviceName];
  if (service === undefined) fail(`missing Compose service: ${serviceName}`);
  return normalizeEnvironment(service.environment);
}

function normalizeEnvironment(environment) {
  if (Array.isArray(environment)) {
    return Object.fromEntries(
      environment.map((entry) => {
        const separator = String(entry).indexOf("=");
        return separator === -1
          ? [String(entry), ""]
          : [String(entry).slice(0, separator), String(entry).slice(separator + 1)];
      })
    );
  }

  return environment ?? {};
}

function assertAdminAuthNamesPresent(environment, label) {
  for (const name of adminAuthEnvNames) {
    assert(Object.hasOwn(environment, name), `${label} must include ${name}`);
  }
}

function assertNoAdminAuthNames(environment, label) {
  for (const name of adminAuthEnvNames) {
    assert(!Object.hasOwn(environment, name), `${label} must not include ${name}`);
  }
}

function baseSyntheticEnv() {
  return {
    MAIN_SERVICE_IMAGE: `sha256:${"1".repeat(64)}`,
    LOG_LEVEL: "info",
    API_HOST_PORT: "3000",
    POSTGRES_USER: "main_service",
    POSTGRES_PASSWORD: "synthetic_postgres_password_32_bytes_min",
    POSTGRES_DB: "main_service",
    DATABASE_URL: "postgresql://main_service:synthetic_postgres_password_32_bytes_min@postgres:5432/main_service?schema=public",
    REDIS_URL: "redis://redis:6379/0",
    TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json",
    TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
    TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
    TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:production",
    TENANT_RATE_LIMIT_KEY_SECRET: "synthetic_rate_limit_secret_32_bytes_min",
    AGENT_KEY: "synthetic_agent_key_32_bytes_minimum",
    CHECKED_AT_MAX_FUTURE_SKEW_SECONDS: "60",
    CHECKED_AT_MAX_AGE_SECONDS: "900",
    ENTRY_RETENTION_DAYS: "30",
    ENTRY_MAX_PER_FEED: "10000",
    ENTRY_DETAIL_RETENTION_DAYS: "7",
    ENTRY_DETAIL_MAX_PER_FEED: "2000",
    BULLMQ_PREFIX: "main-service-production",
    MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS: "604800",
    MAINTENANCE_COMPLETED_JOB_MAX_COUNT: "1000",
    MAINTENANCE_FAILED_JOB_RETENTION_SECONDS: "2592000",
    MAINTENANCE_FAILED_JOB_MAX_COUNT: "5000"
  };
}

function syntheticAdminAuthEnv() {
  const password = "synthetic-ms024d-admin-password";
  const salt = Buffer.from("ms024d-synthetic-salt", "utf8");
  const digest = pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return {
    ADMIN_UI_AUTH_MODE: "single_admin",
    ADMIN_UI_ADMIN_USERNAME: "admin",
    ADMIN_UI_ADMIN_PASSWORD_HASH: [
      "pbkdf2-sha256",
      "120000",
      salt.toString("base64url"),
      digest.toString("base64url")
    ].join("$"),
    ADMIN_UI_SESSION_SECRET: "synthetic_ms024d_admin_session_secret_48_bytes_minimum",
    ADMIN_UI_SESSION_TTL_SECONDS: "900",
    ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
    ADMIN_UI_SESSION_COOKIE_SECURE: "true",
    ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:production"
  };
}

function scrubbedProcessEnv() {
  const env = { ...process.env };
  for (const name of [
    ...adminAuthEnvNames,
    "ADMIN_UI_ADMIN_PASSWORD",
    "ADMIN_AUTH_SMOKE_USERNAME",
    "ADMIN_AUTH_SMOKE_PASSWORD"
  ]) {
    delete env[name];
  }
  return env;
}

function rejectCredentialArgs(args) {
  for (const arg of args) {
    if (/^--?(?:username|password)(?:=|$)/iu.test(arg)) {
      fail("username/password arguments are not accepted by synthetic compose verification");
    }
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
