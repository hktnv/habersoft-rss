import { readFileSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const envFile = args["env-file"];
const runtimeImageEnvFile = args["runtime-image-env"];

if (envFile === undefined) {
  fail("production:config:check requires --env-file <path>");
}

const failures = [];
const sharedEnv = parseEnvFile(path.resolve(envFile));
const runtimeImageEnv = runtimeImageEnvFile === undefined ? {} : parseRuntimeImageEnv(path.resolve(runtimeImageEnvFile));
const env = { ...sharedEnv, ...runtimeImageEnv };

const required = [
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

assert(env.MAIN_SERVICE_IMAGE !== undefined && env.MAIN_SERVICE_IMAGE.trim() !== "", "MAIN_SERVICE_IMAGE is required from runtime image env");
if (runtimeImageEnvFile !== undefined) {
  assert(!Object.hasOwn(sharedEnv, "MAIN_SERVICE_IMAGE"), "shared env file must not define MAIN_SERVICE_IMAGE when runtime-image-env is supplied");
}

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
validateOptionalAdminAuth();

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
  assert(/^sha256:[a-f0-9]{64}$/u.test(value) || /@sha256:[a-f0-9]{64}$/u.test(value), "MAIN_SERVICE_IMAGE must be an immutable sha256 image identity");
}

function parseRuntimeImageEnv(file) {
  const parsed = parseEnvFile(file);
  const keys = Object.keys(parsed);
  assert(keys.length === 1 && keys[0] === "MAIN_SERVICE_IMAGE", "runtime-image-env must contain exactly MAIN_SERVICE_IMAGE");
  assert(/^sha256:[a-f0-9]{64}$/u.test(parsed.MAIN_SERVICE_IMAGE ?? ""), "runtime-image-env MAIN_SERVICE_IMAGE must be sha256 image id");
  return parsed;
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

function validateOptionalAdminAuth() {
  const mode = env.ADMIN_UI_AUTH_MODE === undefined || env.ADMIN_UI_AUTH_MODE.trim() === ""
    ? "disabled"
    : env.ADMIN_UI_AUTH_MODE.trim();

  if (mode !== "disabled" && mode !== "single_admin") {
    failures.push("ADMIN_UI_AUTH_MODE must be disabled or single_admin");
    return;
  }

  if (mode === "disabled") {
    return;
  }

  const username = env.ADMIN_UI_ADMIN_USERNAME ?? "";
  const passwordHash = env.ADMIN_UI_ADMIN_PASSWORD_HASH ?? "";
  const sessionSecret = env.ADMIN_UI_SESSION_SECRET ?? "";
  const ttl = env.ADMIN_UI_SESSION_TTL_SECONDS ?? "3600";
  const cookieName = env.ADMIN_UI_SESSION_COOKIE_NAME === undefined || env.ADMIN_UI_SESSION_COOKIE_NAME.trim() === ""
    ? "habersoft_admin_session"
    : env.ADMIN_UI_SESSION_COOKIE_NAME;
  const cookieSecure = env.ADMIN_UI_SESSION_COOKIE_SECURE === undefined || env.ADMIN_UI_SESSION_COOKIE_SECURE.trim() === ""
    ? "true"
    : env.ADMIN_UI_SESSION_COOKIE_SECURE;
  const redisPrefix = env.ADMIN_UI_SESSION_REDIS_PREFIX === undefined || env.ADMIN_UI_SESSION_REDIS_PREFIX.trim() === ""
    ? "admin_auth:production"
    : env.ADMIN_UI_SESSION_REDIS_PREFIX;

  if (username === "" || isPlaceholderLike(username) || username.trim() !== username || containsAsciiControlCharacter(username)) {
    failures.push("ADMIN_UI_ADMIN_USERNAME must be explicit and contain only visible characters");
  }

  if (passwordHash === "" || isPlaceholderLike(passwordHash) || !isAdminPasswordHashFormat(passwordHash)) {
    failures.push("ADMIN_UI_ADMIN_PASSWORD_HASH must use the pbkdf2-sha256 encoded hash format and must not be a placeholder");
  }

  if (
    sessionSecret === "" ||
    isPlaceholderLike(sessionSecret) ||
    Buffer.byteLength(sessionSecret, "utf8") < 32 ||
    containsAsciiControlCharacter(sessionSecret)
  ) {
    failures.push("ADMIN_UI_SESSION_SECRET must be explicit, non-placeholder, and at least 32 UTF-8 bytes");
  }

  if (!/^[1-9][0-9]*$/u.test(ttl) || Number(ttl) < 1) {
    failures.push("ADMIN_UI_SESSION_TTL_SECONDS must be a positive integer");
  }

  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/u.test(cookieName)) {
    failures.push("ADMIN_UI_SESSION_COOKIE_NAME may contain only letters, digits, underscore, and hyphen");
  }

  if (cookieSecure !== "true") {
    failures.push("ADMIN_UI_SESSION_COOKIE_SECURE must be true in production");
  }

  if (!/^[a-z0-9:_-]+$/u.test(redisPrefix)) {
    failures.push("ADMIN_UI_SESSION_REDIS_PREFIX may contain only lowercase letters, digits, colon, underscore, and hyphen");
  }
}

function isAdminPasswordHashFormat(value) {
  const [algorithm, iterationsText, saltText, digestText, ...extra] = value.replaceAll("$$", "$").split("$");
  if (
    algorithm !== "pbkdf2-sha256" ||
    iterationsText === undefined ||
    saltText === undefined ||
    digestText === undefined ||
    extra.length > 0
  ) {
    return false;
  }

  const iterations = Number(iterationsText);
  const salt = Buffer.from(saltText, "base64url");
  const digest = Buffer.from(digestText, "base64url");
  return Number.isInteger(iterations) && iterations >= 100000 && salt.length >= 16 && digest.length >= 32;
}

function isPlaceholderLike(value) {
  const trimmed = value.trim();
  return (
    /^<[^>]+>$/u.test(trimmed) ||
    /\b(?:operator-provided|operator-generated|replace_with|placeholder|changeme|todo|local_only|change_me)\b/iu.test(trimmed)
  );
}

function containsAsciiControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
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
