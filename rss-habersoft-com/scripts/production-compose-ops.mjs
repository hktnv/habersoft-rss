import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const sharedEnvFile = ".env.production";
const runtimeImageEnvFile = path.join("deploy", "runtime-image.env");
const rawArgs = process.argv.slice(2);
const command = rawArgs[0] ?? "diagnose";
const synthetic = rawArgs.includes("--synthetic");
const passthrough = rawArgs.slice(1).filter((arg) => arg !== "--synthetic");
const missingFiles = synthetic
  ? []
  : [sharedEnvFile, runtimeImageEnvFile].filter((file) => !existsSync(path.join(backendRoot, file)));
const composeBaseArgs = synthetic
  ? ["-f", composeFile]
  : ["--env-file", sharedEnvFile, "--env-file", runtimeImageEnvFile, "-f", composeFile];
const composeEnv = synthetic ? syntheticComposeEnv() : process.env;

rejectCredentialArgs(rawArgs);

switch (command) {
  case "ps":
    requireEnvFiles();
    runCompose([...composeBaseArgs, "ps", ...passthrough]);
    break;
  case "logs":
    requireEnvFiles();
    runCompose([...composeBaseArgs, "logs", "--tail=120", ...(passthrough.length > 0 ? passthrough : ["main-service-api"])]);
    break;
  case "config":
    requireEnvFiles();
    runCompose([...composeBaseArgs, "config", ...passthrough]);
    break;
  case "diagnose":
    diagnose();
    break;
  default:
    fail("usage: production-compose-ops.mjs <ps|logs|config|diagnose> [--synthetic] [docker compose args]");
}

function diagnose() {
  if (missingFiles.length > 0) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "backend-production-compose-diagnostics-blocked",
          compose_file: composeFile,
          missing_operator_files: missingFiles,
          reason: "production backend Compose still requires real operator env and runtime image inputs",
          next_steps: [
            "place operator-owned .env.production without committing it",
            "place operator-owned deploy/runtime-image.env from the verified image package",
            "npm run ops:compose:ps",
            "npm run ops:compose:logs -- main-service-api",
            "npm run production:admin-auth:diagnose:redacted -- --synthetic"
          ],
          output: "redacted"
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
    return;
  }

  const config = runCompose([...composeBaseArgs, "config", "--quiet"], { allowFailure: true, capture: true });
  const ps = runCompose([...composeBaseArgs, "ps"], { allowFailure: true, capture: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: statusOf(config) === 0 ? "backend-production-compose-diagnostics-ok" : "backend-production-compose-diagnostics-failed",
        compose_file: composeFile,
        env_files: synthetic ? "synthetic" : [sharedEnvFile, runtimeImageEnvFile],
        synthetic,
        config_status: statusOf(config),
        ps_status: statusOf(ps),
        admin_auth_runtime_env: "main-service-api",
        worker_admin_auth_env: "absent_by_design",
        next_steps: [
          "npm run ops:compose:ps",
          "npm run ops:compose:logs -- main-service-api",
          "npm run ops:compose:config",
          "npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled",
          "npm run production:admin-auth:diagnose:redacted"
        ],
        output: "redacted"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = statusOf(config) === 0 ? 0 : 1;
}

function requireEnvFiles() {
  if (missingFiles.length === 0) return;
  fail(`missing operator env file(s): ${missingFiles.join(", ")}. Run npm run production:diagnose:redacted for redacted guidance.`);
}

function runCompose(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: backendRoot,
    env: composeEnv,
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });

  if (options.capture !== true) {
    if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
    if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);
    if (result.error !== undefined) process.stderr.write(`${result.error.message}\n`);
  }

  if (!options.allowFailure && statusOf(result) !== 0) {
    process.exit(statusOf(result));
  }

  return result;
}

function statusOf(result) {
  return result.status ?? 1;
}

function syntheticComposeEnv() {
  const env = { ...process.env };
  delete env.ADMIN_UI_ADMIN_PASSWORD;
  delete env.ADMIN_AUTH_SMOKE_PASSWORD;

  return {
    ...env,
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
    MAINTENANCE_FAILED_JOB_MAX_COUNT: "5000",
    ADMIN_UI_AUTH_MODE: "single_admin",
    ADMIN_UI_ADMIN_USERNAME: "admin",
    ADMIN_UI_ADMIN_PASSWORD_HASH: "pbkdf2-sha256$120000$c3ludGhldGljLW1zMDI0ZC1zYWx0$DOgWsz6BZNRuwU47Y9Ui_5J8w7IH0WAxwoqVv4ERHsM",
    ADMIN_UI_SESSION_SECRET: "synthetic_ms024d_admin_session_secret_48_bytes_minimum",
    ADMIN_UI_SESSION_TTL_SECONDS: "900",
    ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
    ADMIN_UI_SESSION_COOKIE_SECURE: "true",
    ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:production"
  };
}

function rejectCredentialArgs(args) {
  for (const arg of args) {
    if (/^--?(?:username|password)(?:=|$)/iu.test(arg)) {
      fail("username/password arguments are not accepted by redacted production Compose helpers");
    }
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
