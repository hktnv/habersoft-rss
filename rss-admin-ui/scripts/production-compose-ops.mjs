import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const backendNetworkFile = path.join("deploy", "production", "compose.backend-network.yaml");
const envFile = ".env.production";
const command = process.argv[2] ?? "diagnose";
const passthrough = process.argv.slice(3);

const composeBaseArgs = [
  ...(existsSync(path.join(frontendRoot, envFile)) ? ["--env-file", envFile] : []),
  "-f",
  composeFile,
  ...(shouldUseBackendNetworkOverlay() ? ["-f", backendNetworkFile] : [])
];

switch (command) {
  case "ps":
    runCompose([...composeBaseArgs, "ps", ...passthrough]);
    break;
  case "logs":
    runCompose([...composeBaseArgs, "logs", "--tail=120", ...(passthrough.length > 0 ? passthrough : ["rss-admin-ui"])]);
    break;
  case "config":
    runCompose([...composeBaseArgs, "config", ...passthrough]);
    break;
  case "diagnose":
    diagnose();
    break;
  default:
    fail(`usage: production-compose-ops.mjs <ps|logs|config|diagnose> [docker compose args]`);
}

function diagnose() {
  const config = runCompose([...composeBaseArgs, "config", "--quiet"], { allowFailure: true, capture: true });
  const ps = runCompose([...composeBaseArgs, "ps"], { allowFailure: true, capture: true });
  const output = {
    status: config.status === 0 ? "frontend-production-compose-diagnostics-ok" : "frontend-production-compose-diagnostics-failed",
    compose_file: composeFile,
    env_file: existsSync(path.join(frontendRoot, envFile)) ? envFile : "not-present",
    backend_network_overlay: shouldUseBackendNetworkOverlay(),
    config_status: config.status,
    ps_status: ps.status,
    next_steps: [
      "npm run ops:compose:ps",
      "npm run ops:compose:logs -- rss-admin-ui",
      "curl -fsS http://127.0.0.1:8081/healthz",
      "npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com"
    ],
    output: "redacted"
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = config.status === 0 ? 0 : 1;
}

function shouldUseBackendNetworkOverlay() {
  return process.env.ADMIN_UI_BACKEND_DOCKER_NETWORK !== undefined && process.env.ADMIN_UI_BACKEND_DOCKER_NETWORK !== "";
}

function runCompose(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: frontendRoot,
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
