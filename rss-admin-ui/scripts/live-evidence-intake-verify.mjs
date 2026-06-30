import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const packageStatus = "MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING";
const priorPackageStatus = "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED";
const authResidual = "AUTH_NOT_CONFIGURED_RESIDUAL";
const configuredUnauthenticated = "AUTH_CONFIGURED_UNAUTHENTICATED";
const failures = [];

const backendOnlyAuthVars = [
  "ADMIN_UI_AUTH_MODE",
  "ADMIN_UI_ADMIN_USERNAME",
  "ADMIN_UI_ADMIN_PASSWORD_HASH",
  "ADMIN_UI_SESSION_SECRET",
  "ADMIN_UI_SESSION_TTL_SECONDS",
  "ADMIN_UI_SESSION_COOKIE_NAME",
  "ADMIN_UI_SESSION_COOKIE_SECURE",
  "ADMIN_UI_SESSION_REDIS_PREFIX"
];
const frontendRuntimeVars = [
  "RSS_ADMIN_UI_IMAGE",
  "ADMIN_UI_HOST_PORT",
  "ADMIN_UI_BACKEND_DOCKER_NETWORK",
  "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
  "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
  "ADMIN_UI_ENVIRONMENT_NAME"
];

assertRequiredFiles();
assertPackageScripts();
assertDocs();
assertRuntimeTemplateSplit();
assertBackendAuthSourceBoundary();
assertDashboardStatusSurface();
assertNoProductionMutationCommands();

if (failures.length > 0) {
  for (const failure of failures) console.error(`live-evidence-intake-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "live-evidence-intake-verify-ok",
      admin_ui_state: packageStatus,
      prior_status_dashboard_state: priorPackageStatus,
      historical_admin_auth_residual: authResidual,
      current_admin_auth_state: configuredUnauthenticated,
      read_only_status_dashboard_transport: "accepted",
      authenticated_admin_acceptance: false,
      production_mutation: false,
      real_secret_use: false,
      registry_publication: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "README.md",
    "PRODUCTION.md",
    ".docs/production-activation-package.md",
    ".docs/status-api-upstream-remediation.md",
    ".docs/live-status-dashboard-acceptance.md",
    ".docs/admin-auth-production-operator-handoff.md",
    "deploy/production/operator-managed.env.template",
    "deploy/production/backend-admin-auth.env.template",
    "deploy/production/compose.yaml",
    "deploy/production/compose.backend-network.yaml",
    "scripts/live-evidence-intake-verify.mjs",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/.docs/admin-auth-production-activation.md",
    "../rss-habersoft-com/src/admin-auth/admin-auth.controller.ts",
    "../rss-habersoft-com/src/admin-auth/admin-auth.service.ts",
    "../rss-habersoft-com/src/configuration/runtime-config.ts",
    "../rss-habersoft-com/test/admin-auth/admin-auth.controller.spec.ts"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const pkg = JSON.parse(readFrontend("package.json"));
  const scripts = pkg.scripts ?? {};
  const required = {
    "verify:live-evidence-intake": "node scripts/live-evidence-intake-verify.mjs",
    "verify:admin-auth-not-configured-remediation": "node scripts/live-evidence-intake-verify.mjs",
    "verify:production-activation-package": "node scripts/production-activation-package-verify.mjs",
    "verify:operator-managed-production-package": "node scripts/operator-managed-production-package-verify.mjs",
    "verify:production-upstream-contract": "node scripts/production-upstream-contract-verify.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
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
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend(".docs/admin-auth-production-activation.md")
  ].join("\n");

  for (const fragment of [
    packageStatus,
    priorPackageStatus,
    authResidual,
    configuredUnauthenticated,
    "codex_public_readonly_verified",
    "operator_reported",
    "operator-reported",
    "read-only status-dashboard production",
    "not authenticated admin product acceptance",
    "/healthz",
    "/status-api/health/live",
    "/status-api/health/ready",
    "/admin-auth/session",
    "501",
    "not_configured",
    "configured=false",
    "configured=true",
    "authenticated=false",
    "unauthenticated",
    "postgres=up",
    "redis=up",
    "tenantAuth=up",
    "Frontend/admin UI runtime env controls",
    "Backend admin-auth runtime env controls",
    "Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth",
    "backend runtime admin-auth env placement",
    "backend API restart/recreate",
    "frontend proxy recovered after canonical overlay helper recreate",
    "npm run ops:compose:recreate",
    "login smoke pending",
    "not continued changes to `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`",
    "Do not paste real admin credentials",
    "No production deployment",
    "no registry",
    "no Git tag",
    "rollback baseline"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-023D fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bauthenticated admin(?:-shell)? production acceptance (?:is )?(?:accepted|complete|passed)\b/iu,
    /\bproduction admin auth\s+(?:is|has been)\s+enabled\b/iu,
    /\bvalid login\s+(?:is|has been)\s+accepted\b/iu,
    /\bfeed\/user\/tenant management\s+(?:is|has been)\s+accepted\b/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden authenticated acceptance claim: ${forbidden}`);
  }
}

function assertRuntimeTemplateSplit() {
  const frontendTemplate = readFrontend("deploy/production/operator-managed.env.template");
  const backendTemplate = readFrontend("deploy/production/backend-admin-auth.env.template");
  const frontendAssignments = parseEnvAssignments(frontendTemplate);
  const backendAssignments = parseEnvAssignments(backendTemplate);
  const frontendCompose = readFrontend("deploy/production/compose.yaml");

  for (const name of frontendRuntimeVars) {
    if (!(name in frontendAssignments)) failures.push(`frontend operator template missing active assignment for ${name}`);
  }
  for (const name of backendOnlyAuthVars) {
    if (name in frontendAssignments) failures.push(`frontend operator template must not actively assign backend-only ${name}`);
    if (!(name in backendAssignments)) failures.push(`backend admin-auth template missing active assignment for ${name}`);
    if (frontendCompose.includes(name)) failures.push(`frontend production compose must not consume backend-only ${name}`);
  }

  for (const fragment of [
    "backend-admin-auth.env.template",
    "does not enable backend auth",
    "HTTP 501 not_configured",
    "keep ADMIN_UI_HEALTH_UPSTREAM_ORIGIN unchanged"
  ]) {
    if (!frontendTemplate.includes(fragment)) failures.push(`frontend operator template missing split warning: ${fragment}`);
  }

  for (const fragment of [
    "backend API service runtime",
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "not to keep changing ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "Do not paste real admin credentials"
  ]) {
    if (!backendTemplate.includes(fragment)) failures.push(`backend admin-auth template missing residual guidance: ${fragment}`);
  }
}

function assertBackendAuthSourceBoundary() {
  const controller = readBackend("src/admin-auth/admin-auth.controller.ts");
  const service = readBackend("src/admin-auth/admin-auth.service.ts");
  const runtimeConfig = readBackend("src/configuration/runtime-config.ts");
  const tests = readBackend("test/admin-auth/admin-auth.controller.spec.ts");

  for (const fragment of [
    "reply.status(501)",
    "!response.configured",
    "session("
  ]) {
    if (!controller.includes(fragment)) failures.push(`admin auth controller missing not_configured HTTP boundary: ${fragment}`);
  }
  for (const fragment of [
    'const disabledAdminAuthConfig: AdminAuthConfig = { mode: "disabled" }',
    "runtimeConfig.adminAuth ?? disabledAdminAuthConfig",
    "notConfiguredResponse()",
    'status: "not_configured"',
    'reason: "not_configured"',
    'message: "Admin authentication is not configured."'
  ]) {
    if (!service.includes(fragment)) failures.push(`admin auth service missing disabled/not_configured boundary: ${fragment}`);
  }
  for (const fragment of [
    'expectedRole === "api"',
    "ADMIN_UI_AUTH_MODE",
    "ADMIN_UI_ADMIN_USERNAME",
    "ADMIN_UI_ADMIN_PASSWORD_HASH",
    "ADMIN_UI_SESSION_SECRET",
    "ADMIN_UI_SESSION_COOKIE_SECURE"
  ]) {
    if (!runtimeConfig.includes(fragment)) failures.push(`runtime config missing backend admin-auth env boundary: ${fragment}`);
  }
  for (const fragment of [
    "expect(response.statusCode).toBe(501)",
    "configured: false",
    'status: "not_configured"',
    "expect(firstSession.statusCode).toBe(200)",
    "authenticated: false"
  ]) {
    if (!tests.includes(fragment)) failures.push(`admin auth tests missing session progression evidence: ${fragment}`);
  }
}

function assertDashboardStatusSurface() {
  const dashboard = readFrontend("src/status/StatusDashboard.tsx");
  const appTest = readFrontend("tests/app-shell.test.tsx");
  for (const fragment of [
    "READ_ONLY_STATUS_DASHBOARD_PRODUCTION_TRANSPORT_ACTIVE",
    authResidual,
    "OUT_OF_SCOPE"
  ]) {
    if (!dashboard.includes(fragment)) failures.push(`dashboard status surface missing ${fragment}`);
    if (!appTest.includes(fragment)) failures.push(`app-shell test missing ${fragment}`);
  }
}

function assertNoProductionMutationCommands() {
  const scripts = [
    "scripts/production-mode-rc.mjs",
    "scripts/status-api-upstream-remediation-harness.mjs"
  ];
  const forbidden = /\b(ssh|scp|sftp|rsync)\b|\bcurl\b\s+https:\/\/rss|Invoke-WebRequest\s+.*https:\/\/rss|fetch\s*\(\s*["']https:\/\/rss|docker\s+(?:compose\s+)?(?:pull|push|restart)\b/iu;
  for (const file of scripts) {
    const text = readFrontend(file);
    if (forbidden.test(text)) failures.push(`local verifier/harness contains production mutation/contact command: ${file}`);
  }
}

function parseEnvAssignments(text) {
  const assignments = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?<name>[A-Z0-9_]+)=(?<value>.*)$/u.exec(line);
    if (match?.groups === undefined) continue;
    assignments[match.groups.name] = match.groups.value;
  }
  return assignments;
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
