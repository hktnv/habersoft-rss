import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const sharedEnvFile = ".env.production";
const runtimeImageEnvFile = path.join("deploy", "runtime-image.env");
const args = process.argv.slice(2);
const apply = args.includes("--apply") || process.env.MAIN_SERVICE_RECREATE_APPLY === "true";
const dryRun = args.includes("--dry-run") || !apply;
const apiOnly = args.includes("--api-only");
const workerOnly = args.includes("--worker-only");
const help = args.includes("--help") || args.includes("-h");

if (help) {
  process.stdout.write(`${JSON.stringify(helpOutput(), null, 2)}\n`);
  process.exit(0);
}

if (args.some((arg) => /^--(?:username|password|token|secret)(?:=|$)/iu.test(arg))) {
  fail("credentials and secrets must not be supplied on production recreate command lines");
}
if (apply && args.includes("--dry-run")) {
  fail("--apply and --dry-run cannot be combined");
}
if (apiOnly && workerOnly) {
  fail("--api-only and --worker-only cannot be combined");
}

const missingOperatorFiles = [sharedEnvFile, runtimeImageEnvFile].filter((file) => !existsSync(path.join(backendRoot, file)));
const services = apiOnly ? ["main-service-api"] : workerOnly ? ["main-service-worker"] : ["main-service-api", "main-service-worker"];
const composeArgs = [
  "--env-file",
  sharedEnvFile,
  "--env-file",
  runtimeImageEnvFile,
  "-f",
  composeFile,
  "up",
  "-d",
  "--no-build",
  "--pull",
  "never",
  "--force-recreate",
  ...services
];

if (missingOperatorFiles.length > 0 && apply) {
  process.stdout.write(`${JSON.stringify(summary("backend-api-worker-recreate-blocked"), null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(summary(dryRun ? "backend-api-worker-recreate-dry-run" : "backend-api-worker-recreate-apply"), null, 2)}\n`);

if (!dryRun) {
  runCompose(composeArgs);
}

function summary(status) {
  return {
    status,
    dry_run: dryRun,
    apply,
    apply_required_for_mutation: true,
    compose_file: composeFile,
    env_files: missingOperatorFiles.length === 0 ? [sharedEnvFile, runtimeImageEnvFile] : "missing",
    missing_operator_files: missingOperatorFiles,
    services,
    command_classification: "operator_mutating_when_apply_true",
    command_preview: ["docker", "compose", ...composeArgs].join(" "),
    admin_auth_runtime_env: "main-service-api",
    worker_admin_auth_env: "absent_by_design",
    next_steps: [
      "verify operator rollback/current-state evidence before --apply",
      "run npm run production:admin-auth:diagnose:redacted before or after backend recreate",
      "after backend API/image/network/admin-auth env recreate, run cd ../rss-admin-ui && npm run ops:compose:recreate -- --apply",
      "then run npm run ops:production:retest:redacted from rss-admin-ui"
    ],
    output: "redacted"
  };
}

function runCompose(composeArgsToRun) {
  const result = spawnSync("docker", ["compose", ...composeArgsToRun], {
    cwd: backendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 180000
  });

  if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
  if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function helpOutput() {
  return {
    status: "backend-api-worker-recreate-help",
    usage: "node scripts/production-api-worker-recreate.mjs [--dry-run|--apply] [--api-only|--worker-only]",
    default: "dry-run",
    credential_policy: "credentials and secrets are never accepted as CLI arguments",
    apply_policy: "production mutation requires --apply",
    output: "redacted"
  };
}

function fail(message) {
  process.stderr.write(`production-api-worker-recreate: ${message}\n`);
  process.exit(1);
}
