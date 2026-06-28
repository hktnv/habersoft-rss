import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ADMIN_PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const ADMIN_PASSWORD_HASH_ITERATIONS = 120000;
const ADMIN_PASSWORD_HASH_KEY_BYTES = 32;
const ADMIN_PASSWORD_HASH_SALT_BYTES = 16;
const SESSION_SECRET_BYTES = 48;

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--"));
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

try {
  switch (command) {
    case "hash":
      await hashCommand();
      break;
    case "secret":
      secretCommand();
      break;
    case "verify-config":
      verifyConfigCommand();
      break;
    default:
      fail("usage: admin-auth-provisioning.mjs <hash|secret|verify-config> [--verify|--validate|--synthetic|--require-enabled|--emit-sensitive-output]");
  }
} catch (error) {
  if (error instanceof Error) {
    fail(error.message);
  }
  fail("unexpected admin auth provisioning error");
}

async function hashCommand() {
  const password = await readSecretInput("ADMIN_UI_ADMIN_PASSWORD");

  if (flags.has("--verify")) {
    const encodedHash = process.env.ADMIN_UI_ADMIN_PASSWORD_HASH;
    if (encodedHash === undefined || encodedHash.trim() === "") {
      fail("ADMIN_UI_ADMIN_PASSWORD_HASH is required for hash verification");
    }

    if (!verifyAdminPasswordHash(password, encodedHash)) {
      fail("ADMIN_UI_ADMIN_PASSWORD_HASH did not verify for the supplied password");
    }

    writeJson({
      status: "admin-auth-password-hash-verify-ok",
      password_hash: "redacted"
    });
    return;
  }

  const encodedHash = hashAdminPassword(password);
  const response = {
    status: "admin-auth-password-hash-generated",
    algorithm: ADMIN_PASSWORD_HASH_ALGORITHM,
    iterations: ADMIN_PASSWORD_HASH_ITERATIONS,
    salt_bytes: ADMIN_PASSWORD_HASH_SALT_BYTES,
    key_bytes: ADMIN_PASSWORD_HASH_KEY_BYTES,
    password_hash: flags.has("--emit-sensitive-output") ? encodedHash : "redacted"
  };

  writeJson(response);
}

function secretCommand() {
  if (flags.has("--validate")) {
    const secret = process.env.ADMIN_UI_SESSION_SECRET;
    const issues = validateSessionSecret(secret, process.env.APP_ENV === "production");
    if (issues.length > 0) {
      fail(issues.join("; "));
    }

    writeJson({
      status: "admin-auth-session-secret-verify-ok",
      session_secret: "redacted",
      min_utf8_bytes: 32
    });
    return;
  }

  const secret = randomBytes(SESSION_SECRET_BYTES).toString("base64url");
  writeJson({
    status: "admin-auth-session-secret-generated",
    bytes: SESSION_SECRET_BYTES,
    encoding: "base64url",
    session_secret: flags.has("--emit-sensitive-output") ? secret : "redacted"
  });
}

function verifyConfigCommand() {
  const env = flags.has("--synthetic") ? syntheticAdminAuthEnv() : process.env;
  const issues = validateAdminAuthEnv(env, flags.has("--require-enabled"));

  if (issues.length > 0) {
    fail(issues.join("; "));
  }

  writeJson({
    status: "admin-auth-config-verify-ok",
    app_env: env.APP_ENV === "production" ? "production" : "non-production",
    mode: env.ADMIN_UI_AUTH_MODE?.trim() === "single_admin" ? "single_admin" : "disabled",
    admin_username: env.ADMIN_UI_ADMIN_USERNAME === undefined ? "not-set" : "present",
    password_hash: env.ADMIN_UI_ADMIN_PASSWORD_HASH === undefined ? "not-set" : "redacted",
    session_secret: env.ADMIN_UI_SESSION_SECRET === undefined ? "not-set" : "redacted",
    cookie_secure_required: env.APP_ENV === "production"
  });
}

function validateAdminAuthEnv(env, requireEnabled) {
  const issues = [];
  const mode = env.ADMIN_UI_AUTH_MODE === undefined || env.ADMIN_UI_AUTH_MODE.trim() === ""
    ? "disabled"
    : env.ADMIN_UI_AUTH_MODE;
  const production = env.APP_ENV === "production";

  if (mode !== "disabled" && mode !== "single_admin") {
    issues.push("ADMIN_UI_AUTH_MODE is invalid");
    return issues;
  }

  if (mode === "disabled") {
    if (requireEnabled) issues.push("ADMIN_UI_AUTH_MODE must be single_admin for activation");
    return issues;
  }

  const username = env.ADMIN_UI_ADMIN_USERNAME ?? "";
  const passwordHash = env.ADMIN_UI_ADMIN_PASSWORD_HASH ?? "";
  const sessionSecret = env.ADMIN_UI_SESSION_SECRET ?? "";
  const ttl = env.ADMIN_UI_SESSION_TTL_SECONDS ?? "3600";
  const cookieName = env.ADMIN_UI_SESSION_COOKIE_NAME === undefined || env.ADMIN_UI_SESSION_COOKIE_NAME.trim() === ""
    ? "habersoft_admin_session"
    : env.ADMIN_UI_SESSION_COOKIE_NAME;
  const cookieSecure = parseBoolean(env.ADMIN_UI_SESSION_COOKIE_SECURE, production, "ADMIN_UI_SESSION_COOKIE_SECURE", issues);
  const redisPrefix = env.ADMIN_UI_SESSION_REDIS_PREFIX === undefined || env.ADMIN_UI_SESSION_REDIS_PREFIX.trim() === ""
    ? "admin_auth:session"
    : env.ADMIN_UI_SESSION_REDIS_PREFIX;

  if (username === "") {
    issues.push("ADMIN_UI_ADMIN_USERNAME is required");
  } else {
    if (username.trim() !== username) issues.push("ADMIN_UI_ADMIN_USERNAME must not include leading or trailing whitespace");
    if (username.length > 128 || containsAsciiControlCharacter(username)) {
      issues.push("ADMIN_UI_ADMIN_USERNAME must be 1-128 visible characters");
    }
  }

  if (!isAdminPasswordHashFormat(passwordHash)) {
    issues.push("ADMIN_UI_ADMIN_PASSWORD_HASH must use the pbkdf2-sha256 encoded hash format");
  }

  issues.push(...validateSessionSecret(sessionSecret, production));

  if (!/^[1-9][0-9]*$/u.test(ttl) || Number(ttl) < 1) {
    issues.push("ADMIN_UI_SESSION_TTL_SECONDS must be a positive integer");
  }

  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/u.test(cookieName)) {
    issues.push("ADMIN_UI_SESSION_COOKIE_NAME may contain only letters, digits, underscore, and hyphen");
  }

  if (!/^[a-z0-9:_-]+$/u.test(redisPrefix)) {
    issues.push("ADMIN_UI_SESSION_REDIS_PREFIX may contain only lowercase letters, digits, colon, underscore, and hyphen");
  }

  if (production && !cookieSecure) {
    issues.push("ADMIN_UI_SESSION_COOKIE_SECURE must be true in production");
  }

  return issues;
}

function validateSessionSecret(secret, production) {
  const issues = [];
  if (secret === undefined || secret === "") {
    issues.push("ADMIN_UI_SESSION_SECRET is required");
    return issues;
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    issues.push("ADMIN_UI_SESSION_SECRET must be at least 32 UTF-8 bytes");
  }

  if (containsAsciiControlCharacter(secret)) {
    issues.push("ADMIN_UI_SESSION_SECRET must not contain ASCII control characters");
  }

  if (production && (secret.includes("replace_with") || secret.includes("local_only"))) {
    issues.push("ADMIN_UI_SESSION_SECRET must be explicit in production");
  }

  return issues;
}

function syntheticAdminAuthEnv() {
  const password = "synthetic-ms022b-admin-password";
  return {
    APP_ENV: "production",
    ADMIN_UI_AUTH_MODE: "single_admin",
    ADMIN_UI_ADMIN_USERNAME: "admin",
    ADMIN_UI_ADMIN_PASSWORD_HASH: hashAdminPassword(password, Buffer.from("ms022b-synthetic", "utf8")),
    ADMIN_UI_SESSION_SECRET: "synthetic_ms022b_admin_session_secret_48_bytes_minimum",
    ADMIN_UI_SESSION_TTL_SECONDS: "900",
    ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
    ADMIN_UI_SESSION_COOKIE_SECURE: "true",
    ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:production"
  };
}

function hashAdminPassword(password, salt = randomBytes(ADMIN_PASSWORD_HASH_SALT_BYTES)) {
  const digest = pbkdf2Sync(password, salt, ADMIN_PASSWORD_HASH_ITERATIONS, ADMIN_PASSWORD_HASH_KEY_BYTES, "sha256");
  return [
    ADMIN_PASSWORD_HASH_ALGORITHM,
    ADMIN_PASSWORD_HASH_ITERATIONS.toString(),
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join("$");
}

function verifyAdminPasswordHash(password, encodedHash) {
  const parsed = parseAdminPasswordHash(encodedHash);
  if (parsed === undefined) return false;

  const candidate = pbkdf2Sync(password, parsed.salt, parsed.iterations, parsed.digest.length, "sha256");
  return candidate.length === parsed.digest.length && timingSafeEqual(candidate, parsed.digest);
}

function parseAdminPasswordHash(encodedHash) {
  const [algorithm, iterationsText, saltText, digestText, ...extra] = encodedHash.split("$");
  if (
    algorithm !== ADMIN_PASSWORD_HASH_ALGORITHM ||
    iterationsText === undefined ||
    saltText === undefined ||
    digestText === undefined ||
    extra.length > 0
  ) {
    return undefined;
  }

  const iterations = Number(iterationsText);
  const salt = Buffer.from(saltText, "base64url");
  const digest = Buffer.from(digestText, "base64url");
  if (!Number.isInteger(iterations) || iterations < 100000) return undefined;
  if (salt.length < ADMIN_PASSWORD_HASH_SALT_BYTES || digest.length < ADMIN_PASSWORD_HASH_KEY_BYTES) return undefined;

  return { iterations, salt, digest };
}

function isAdminPasswordHashFormat(value) {
  if (value === undefined || value === "") return false;
  return parseAdminPasswordHash(value) !== undefined;
}

function parseBoolean(value, defaultValue, name, issues) {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  issues.push(`${name} must be true or false`);
  return defaultValue;
}

function containsAsciiControlCharacter(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

async function readSecretInput(envName) {
  if (process.env[envName] !== undefined) {
    return process.env[envName];
  }

  if (process.stdin.isTTY) {
    fail(`${envName} or stdin is required`);
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/u, "");
  if (value === "") fail(`${envName} or stdin is required`);
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`admin-auth-provisioning: ${message}\n`);
  process.exit(1);
}
