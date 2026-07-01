import { pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(backendRoot, "deploy", "production", "compose.yaml");
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
const requiredSingleAdminEnvNames = [
  "ADMIN_UI_AUTH_MODE",
  "ADMIN_UI_ADMIN_USERNAME",
  "ADMIN_UI_ADMIN_PASSWORD_HASH",
  "ADMIN_UI_SESSION_SECRET"
];
const optionalDefaultedEnvNames = [
  "ADMIN_UI_SESSION_TTL_SECONDS",
  "ADMIN_UI_SESSION_COOKIE_NAME",
  "ADMIN_UI_SESSION_COOKIE_SECURE",
  "ADMIN_UI_SESSION_REDIS_PREFIX"
];
const { flags, options } = parseArgs(process.argv.slice(2));

rejectCredentialArgs(process.argv.slice(2));

if (flags.has("--synthetic") && options.has("--env-file")) {
  fail("--synthetic and --env-file are mutually exclusive");
}

const envSource = resolveEnvSource();
const wiring = inspectComposeWiring();
const assessment = classifyAdminAuth(envSource.env, flags.has("--require-enabled"));
const classifications = [...assessment.classifications];

for (const name of wiring.missingApiEnv) classifications.push(`COMPOSE_API_ENV_MISSING_${name}`);
if (wiring.workerAdminAuthEnv.length > 0) classifications.push("COMPOSE_WORKER_ADMIN_AUTH_ENV_PRESENT");
const diagnosticClasses = unique([
  ...assessment.diagnosticClasses,
  wiring.workerAdminAuthEnv.length === 0 ? "worker_absent_by_design" : "worker_admin_auth_env_unexpected_present",
  ...(wiring.missingApiEnv.length > 0 ? ["required_missing"] : [])
]);

const attentionRequired = classifications.some(
  (classification) =>
    classification !== "ADMIN_AUTH_DISABLED" &&
    classification !== "ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT"
);
const status = attentionRequired
  ? "backend-admin-auth-diagnostics-attention-required"
  : "backend-admin-auth-diagnostics-ok";

writeJson({
  status,
  source: envSource.source,
  runtime_target: "main-service-api",
  worker_admin_auth_env: wiring.workerAdminAuthEnv.length === 0 ? "worker_absent_by_design" : "unexpected_present",
  compose_wiring: {
    api_admin_auth_env_names: wiring.missingApiEnv.length === 0 ? "present" : "incomplete",
    worker_admin_auth_env_names: wiring.workerAdminAuthEnv.length === 0 ? "absent" : "present"
  },
  classifications,
  diagnostic_classes: diagnosticClasses,
  variables: Object.fromEntries(adminAuthEnvNames.map((name) => [name, variableStatus(envSource.env, name)])),
  next_steps: [
    "npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled",
    "npm run production:admin-auth:compose:verify",
    "npm run production:diagnose:redacted",
    "recreate main-service-api after operator-owned admin-auth env changes",
    "after backend API/image/network/admin-auth env recreate, run: cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate -- --apply",
    "use frontend auth smoke as a redacted regression/sanity tool; operator-reported MS-024F acceptance is recorded separately without requiring Codex credentialed login"
  ],
  output: "redacted"
});

process.exitCode = attentionRequired ? 1 : 0;

function resolveEnvSource() {
  if (flags.has("--synthetic")) {
    return { source: "synthetic", env: syntheticAdminAuthEnv() };
  }

  if (options.has("--env-file")) {
    return { source: "env-file", env: loadEnvFile(options.get("--env-file")) };
  }

  const defaultEnvFile = path.join(backendRoot, ".env.production");
  if (!existsSync(defaultEnvFile)) {
    writeJson({
      status: "backend-admin-auth-diagnostics-blocked",
      source: ".env.production",
      reason: "operator-owned production env file is not present in this checkout",
      next_steps: [
        "run npm run production:admin-auth:diagnose:redacted -- --synthetic for local verification",
        "place operator-owned .env.production outside Git before production diagnostics"
      ],
      output: "redacted"
    });
    process.exit(1);
  }

  return { source: ".env.production", env: loadEnvFile(defaultEnvFile) };
}

function classifyAdminAuth(env, requireEnabled) {
  const classifications = [];
  const diagnosticClasses = [];
  const mode = env.ADMIN_UI_AUTH_MODE === undefined || env.ADMIN_UI_AUTH_MODE.trim() === ""
    ? "disabled"
    : env.ADMIN_UI_AUTH_MODE.trim();

  if (mode !== "disabled" && mode !== "single_admin") {
    return { classifications: ["ADMIN_AUTH_MODE_INVALID"], diagnosticClasses: ["required_missing"] };
  }

  if (mode === "disabled") {
    classifications.push(requireEnabled ? "ADMIN_AUTH_DISABLED_BUT_REQUIRED" : "ADMIN_AUTH_DISABLED");
    if (requireEnabled) diagnosticClasses.push("required_missing");
    return { classifications, diagnosticClasses };
  }

  const issues = [];
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

  if (requiredSingleAdminEnvNames.some((name) => isMissingOrEmpty(env[name]))) {
    diagnosticClasses.push("required_missing");
  }
  if (optionalDefaultedEnvNames.some((name) => isMissingOrEmpty(env[name]))) {
    diagnosticClasses.push("optional_defaulted");
  }

  if (username === "" || isPlaceholderLike(username) || username.trim() !== username || containsAsciiControlCharacter(username)) {
    issues.push("ADMIN_AUTH_USERNAME_INVALID_OR_PLACEHOLDER");
  }

  if (passwordHash === "" || isPlaceholderLike(passwordHash) || !isAdminPasswordHashFormat(passwordHash)) {
    issues.push("ADMIN_AUTH_PASSWORD_HASH_INVALID_OR_PLACEHOLDER");
  }

  if (
    sessionSecret === "" ||
    isPlaceholderLike(sessionSecret) ||
    Buffer.byteLength(sessionSecret, "utf8") < 32 ||
    containsAsciiControlCharacter(sessionSecret)
  ) {
    issues.push("ADMIN_AUTH_SESSION_SECRET_WEAK_OR_PLACEHOLDER");
  }

  if (!/^[1-9][0-9]*$/u.test(ttl) || Number(ttl) < 1) {
    issues.push("ADMIN_AUTH_SESSION_TTL_INVALID");
  }

  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/u.test(cookieName)) {
    issues.push("ADMIN_AUTH_COOKIE_NAME_INVALID");
  }

  if (cookieSecure !== "true") {
    issues.push("ADMIN_AUTH_COOKIE_SECURE_NOT_TRUE");
  }

  if (!/^[a-z0-9:_-]+$/u.test(redisPrefix)) {
    issues.push("ADMIN_AUTH_REDIS_PREFIX_INVALID");
  }

  if (issues.length === 0) {
    diagnosticClasses.push(
      "configured_present",
      "auth_configured_unauthenticated",
      "authenticated_login_not_yet_proven",
      "frontend_proxy_recreate_required"
    );
    return { classifications: ["ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT"], diagnosticClasses };
  }

  return { classifications: issues, diagnosticClasses };
}

function inspectComposeWiring() {
  const composeText = readFileSync(composeFile, "utf8");
  const apiBlock = serviceBlock(composeText, "main-service-api");
  const workerBlock = serviceBlock(composeText, "main-service-worker");
  return {
    missingApiEnv: adminAuthEnvNames.filter((name) => !apiBlock.includes(`${name}:`)),
    workerAdminAuthEnv: adminAuthEnvNames.filter((name) => workerBlock.includes(`${name}:`))
  };
}

function serviceBlock(text, serviceName) {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start === -1) return "";

  const selected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [A-Za-z0-9_-]+:\s*$/u.test(line)) break;
    selected.push(line);
  }

  return selected.join("\n");
}

function syntheticAdminAuthEnv() {
  const password = "synthetic-ms024d-admin-password";
  const salt = Buffer.from("ms024d-synthetic-salt", "utf8");
  const digest = pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return {
    APP_ENV: "production",
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

function loadEnvFile(file) {
  const resolved = path.resolve(file);
  if (/^ms-023a-secrets\.json$/iu.test(path.basename(resolved))) {
    fail("refusing to read ms-023a-secrets.json");
  }

  const env = {};
  const text = readFileSync(resolved, "utf8");
  for (const [lineIndex, rawLine] of text.split(/\r?\n/u).entries()) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();

    const match = /^(?<name>[A-Z0-9_]+)=(?<value>.*)$/u.exec(line);
    if (match?.groups === undefined) {
      fail(`invalid env-file assignment on line ${lineIndex + 1}`);
    }

    let value = match.groups.value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match.groups.name] = value;
  }

  return { APP_ENV: "production", ...env };
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

function variableStatus(env, name) {
  if (requiredSingleAdminEnvNames.includes(name)) {
    return isMissingOrEmpty(env[name]) ? "required_missing" : "configured_present";
  }

  if (optionalDefaultedEnvNames.includes(name)) {
    return isMissingOrEmpty(env[name]) ? "optional_defaulted" : "configured_present";
  }

  return isMissingOrEmpty(env[name]) ? "required_missing" : "configured_present";
}

function isMissingOrEmpty(value) {
  return value === undefined || value.trim() === "";
}

function unique(values) {
  return [...new Set(values)];
}

function parseArgs(rawArgs) {
  const parsedFlags = new Set();
  const parsedOptions = new Map();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--synthetic" || arg === "--require-enabled") {
      parsedFlags.add(arg);
      continue;
    }

    if (arg === "--env-file") {
      const value = rawArgs[index + 1];
      if (value === undefined || value.startsWith("--")) fail("--env-file requires a path");
      parsedOptions.set(arg, value);
      index += 1;
      continue;
    }

    fail(`unknown argument: ${arg}`);
  }

  return { flags: parsedFlags, options: parsedOptions };
}

function rejectCredentialArgs(args) {
  for (const arg of args) {
    if (/^--?(?:username|password)(?:=|$)/iu.test(arg)) {
      fail("username/password arguments are not accepted by redacted admin-auth diagnostics");
    }
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
