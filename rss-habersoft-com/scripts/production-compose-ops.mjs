import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const sharedEnvFile = ".env.production";
const runtimeImageEnvFile = path.join("deploy", "runtime-image.env");
const command = process.argv[2] ?? "diagnose";
const passthrough = process.argv.slice(3);
const missingFiles = [sharedEnvFile, runtimeImageEnvFile].filter((file) => !existsSync(path.join(backendRoot, file)));
const composeBaseArgs = [
  "--env-file",
  sharedEnvFile,
  "--env-file",
  runtimeImageEnvFile,
  "-f",
  composeFile
];

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
    fail("usage: production-compose-ops.mjs <ps|logs|config|diagnose> [docker compose args]");
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
            "npm run ops:compose:logs -- main-service-api"
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
        status: config.status === 0 ? "backend-production-compose-diagnostics-ok" : "backend-production-compose-diagnostics-failed",
        compose_file: composeFile,
        env_files: [sharedEnvFile, runtimeImageEnvFile],
        config_status: config.status,
        ps_status: ps.status,
        next_steps: [
          "npm run ops:compose:ps",
          "npm run ops:compose:logs -- main-service-api",
          "npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled"
        ],
        output: "redacted"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = config.status === 0 ? 0 : 1;
}

function requireEnvFiles() {
  if (missingFiles.length === 0) return;
  fail(`missing operator env file(s): ${missingFiles.join(", ")}. Run npm run production:diagnose:redacted for redacted guidance.`);
}

function runCompose(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: backendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });

  if (options.capture !== true) {
    if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
    if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);
  }

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
