import { readFileSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const envFile = args["env-file"];

if (envFile === undefined) {
  fail("production:config:check requires --env-file <path>");
}

const env = parseEnvFile(path.resolve(envFile));
const failures = [];

const required = [
  "MAIN_SERVICE_IMAGE",
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
  "MAINTENANCE_FAILED_JOB_MAX_COUNT"
];

for (const name of required) {
  if (env[name] === undefined || env[name].trim() === "") {
    failures.push(`${name} is required`);
  }
}

requireDigestPinnedImage(env.MAIN_SERVICE_IMAGE);
requireInteger("API_HOST_PORT", 1, 65535);
requireUrl("DATABASE_URL", ["postgresql:"], { localServiceHost: "postgres" });
requireUrl("REDIS_URL", ["redis:", "rediss:"], { localServiceHost: "redis" });
requireHttpsJwks("TENANT_AUTH_JWKS_URL");

for (const name of [
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
]) {
  requireInteger(name, 1, Number.MAX_SAFE_INTEGER);
}

requirePattern("TENANT_RATE_LIMIT_REDIS_PREFIX", /^[a-z0-9:_-]+$/u);
requirePattern("BULLMQ_PREFIX", /^[a-z0-9:_-]+$/u);
requireExplicitSecret("POSTGRES_PASSWORD", 16);
requireExplicitSecret("TENANT_RATE_LIMIT_KEY_SECRET", 32);
requireExplicitSecret("AGENT_KEY", 32);
assert(env.LOG_LEVEL === "debug" || env.LOG_LEVEL === "info" || env.LOG_LEVEL === "warn" || env.LOG_LEVEL === "error", "LOG_LEVEL is invalid");
assert(!Object.hasOwn(env, "APP_ENV") || env.APP_ENV === "production", "APP_ENV may only be production in production env files");

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`production-config-check: ${failure}`);
  }
  process.exit(1);
}

console.log("production-config-check: ok");

function requireDigestPinnedImage(value) {
  if (value === undefined) {
    return;
  }

  assert(!value.endsWith(":latest"), "MAIN_SERVICE_IMAGE must not use latest");
  assert(value.includes("@sha256:"), "MAIN_SERVICE_IMAGE must be digest-pinned with @sha256:");
  assert(/@sha256:[a-f0-9]{64}$/u.test(value), "MAIN_SERVICE_IMAGE digest must be a lowercase sha256 digest");
}

function requireUrl(name, protocols, options = {}) {
  const value = env[name];
  if (value === undefined) {
    return;
  }

  try {
    const parsed = new URL(value);
    assert(protocols.includes(parsed.protocol), `${name} uses unsupported protocol`);
    if (options.localServiceHost !== undefined) {
      assert(parsed.hostname === options.localServiceHost, `${name} must target ${options.localServiceHost} on the Compose network`);
    }
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}

function requireHttpsJwks(name) {
  const value = env[name];
  if (value === undefined) {
    return;
  }

  try {
    const parsed = new URL(value);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "tenant-auth-jwks-fixture"]);
    assert(parsed.protocol === "https:", `${name} must use HTTPS`);
    assert(!localHosts.has(parsed.hostname), `${name} must not target a local fixture`);
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}

function requireInteger(name, min, max) {
  const value = Number(env[name]);
  assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer between ${min} and ${max}`);
}

function requirePattern(name, pattern) {
  const value = env[name];
  if (value !== undefined) {
    assert(pattern.test(value), `${name} has invalid characters`);
  }
}

function requireExplicitSecret(name, minBytes) {
  const value = env[name];
  if (value === undefined) {
    return;
  }

  assert(Buffer.byteLength(value, "utf8") >= minBytes, `${name} must be at least ${minBytes} UTF-8 bytes`);
  assert(!/replace_with|local_only|change_me|example|placeholder|<|>/iu.test(value), `${name} must be explicit and not a placeholder`);
  assert(value.trim() === value, `${name} must not include leading or trailing whitespace`);
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function parseEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator === -1) {
          fail(`invalid env line: ${line}`);
        }

        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    result[arg.slice(2)] = rawArgs[index + 1];
    index += 1;
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
