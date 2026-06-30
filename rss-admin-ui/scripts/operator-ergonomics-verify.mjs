import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

assertPackageScripts();
assertComposeInspectionDefaults();
assertGraduatedRuntimeGuardrails();
assertSmokeDiagnostics();
assertDocs();

if (failures.length > 0) {
  for (const failure of failures) console.error(`operator-ergonomics-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "operator-ergonomics-verify-ok",
      compose_inspection_without_env_file: true,
      graduated_proxy_guardrails: true,
      auth_smoke_diagnostics: true,
      helper_scripts: true,
      production_contact: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertPackageScripts() {
  const frontendScripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const backendScripts = JSON.parse(readBackend("package.json")).scripts ?? {};
  const requiredFrontend = {
    "verify:operator-ergonomics": "node scripts/operator-ergonomics-verify.mjs",
    "verify:production-overlay-canonicalization": "node scripts/production-overlay-canonicalization-harness.mjs",
    "ops:compose:config": "node scripts/production-compose-ops.mjs config",
    "ops:compose:up": "node scripts/production-compose-ops.mjs up",
    "ops:compose:recreate": "node scripts/production-compose-ops.mjs recreate",
    "ops:compose:ps": "node scripts/production-compose-ops.mjs ps",
    "ops:compose:logs": "node scripts/production-compose-ops.mjs logs",
    "production:diagnose:redacted": "node scripts/production-compose-ops.mjs diagnose"
  };
  const requiredBackend = {
    "ops:compose:ps": "node scripts/production-compose-ops.mjs ps",
    "ops:compose:logs": "node scripts/production-compose-ops.mjs logs",
    "production:diagnose:redacted": "node scripts/production-compose-ops.mjs diagnose"
  };
  for (const [name, command] of Object.entries(requiredFrontend)) {
    if (frontendScripts[name] !== command) failures.push(`frontend package.json missing ${name}`);
  }
  for (const [name, command] of Object.entries(requiredBackend)) {
    if (backendScripts[name] !== command) failures.push(`backend package.json missing ${name}`);
  }
  for (const file of [
    "scripts/production-compose-ops.mjs",
    "scripts/operator-ergonomics-verify.mjs",
    "scripts/production-overlay-canonicalization-harness.mjs",
    "../rss-habersoft-com/scripts/production-compose-ops.mjs"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertComposeInspectionDefaults() {
  const compose = readFrontend("deploy/production/compose.yaml");
  for (const fragment of [
    "image: ${RSS_ADMIN_UI_IMAGE:-habersoft-rss-frontend:latest}",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: ${ADMIN_UI_HEALTH_UPSTREAM_ORIGIN:-}",
    "ADMIN_UI_ENVIRONMENT_NAME: ${ADMIN_UI_ENVIRONMENT_NAME:-production}",
    "127.0.0.1:${ADMIN_UI_HOST_PORT:-8081}:8080"
  ]) {
    if (!compose.includes(fragment)) failures.push(`frontend compose missing inspection default: ${fragment}`);
  }

  const result = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"]);
  if (result.status !== 0) failures.push(`frontend production compose did not render without env file: ${result.stderr}`);
}

function assertGraduatedRuntimeGuardrails() {
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const nginx = readFrontend("nginx.conf");
  for (const fragment of [
    "status_degraded_routes",
    "auth_degraded_routes",
    "invalid_upstream_origin",
    "public_edge_upstream_rejected",
    "upstream_unavailable",
    "upstream_forbidden",
    "ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION",
    "status_api_upstream_origin",
    "proxy_hide_header Access-Control-Allow-Origin;",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`entrypoint missing graduated guardrail fragment: ${fragment}`);
  }
  for (const fragment of ["__ADMIN_UI_STATUS_ROUTES__", "__ADMIN_UI_AUTH_ROUTES__", "location = /healthz", "resolver 127.0.0.11"]) {
    if (!nginx.includes(fragment)) failures.push(`nginx template missing generated route fragment: ${fragment}`);
  }
}

function assertSmokeDiagnostics() {
  const smoke = readFrontend("scripts/admin-auth-smoke.mjs");
  const harness = readFrontend("scripts/admin-auth-smoke-harness.mjs");
  for (const fragment of [
    "--endpoint",
    "ENDPOINT_UNREACHABLE",
    "HEALTHZ_UNAVAILABLE",
    "STATUS_API_UPSTREAM_MISCONFIGURED",
    "STATUS_API_UPSTREAM_UNAVAILABLE",
    "ADMIN_AUTH_UPSTREAM_MISCONFIGURED",
    "LOGIN_ROUTE_UNAVAILABLE",
    "INVALID_CREDENTIALS",
    "COOKIE_NOT_ESTABLISHED",
    "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
    "LOGOUT_FAILED",
    "next_steps",
    "frontend container may be down/restarting",
    "backend admin-auth env likely not loaded",
    "do not use 127.0.0.1 inside Docker bridge"
  ]) {
    if (!smoke.includes(fragment)) failures.push(`auth smoke missing diagnostic fragment: ${fragment}`);
  }
  for (const fragment of [
    "ENDPOINT_UNREACHABLE",
    "HEALTHZ_UNAVAILABLE",
    "STATUS_API_UPSTREAM_MISCONFIGURED",
    "ADMIN_AUTH_UPSTREAM_MISCONFIGURED",
    "COOKIE_NOT_ESTABLISHED",
    "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
    "LOGOUT_FAILED",
    "assertSanitized"
  ]) {
    if (!harness.includes(fragment)) failures.push(`auth smoke harness missing classification fragment: ${fragment}`);
  }
}

function assertDocs() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/status-api-upstream-remediation.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");
  for (const fragment of [
    "MS-024B operator retest checklist",
    "graduated guardrails",
    "npm run ops:compose:ps",
    "npm run ops:compose:logs",
    "npm run ops:compose:config",
    "npm run ops:compose:up",
    "npm run production:diagnose:redacted",
    "npm run verify:operator-ergonomics",
    "npm run verify:production-overlay-canonicalization",
    "habersoft-rss-frontend:latest",
    "operator-managed mutable local image default",
    "invalid_upstream_origin",
    "public_edge_upstream_rejected",
    "upstream_unavailable",
    "upstream_forbidden",
    "frontend container may be down/restarting",
    "authenticated admin shell remains pending",
    "no live acceptance claimed"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-024B fragment: ${fragment}`);
  }
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: frontendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });
}

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) failures.push(`missing required file: ${label}`);
}

function readRoot(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

function readFrontend(relative) {
  return readFileSync(path.join(frontendRoot, relative), "utf8");
}

function readBackend(relative) {
  return readFileSync(path.join(backendRoot, relative), "utf8");
}
