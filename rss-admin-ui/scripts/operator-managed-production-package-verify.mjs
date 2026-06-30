import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const packageStatus = "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED";
const currentStatus = "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED";
const failures = [];

assertRequiredFiles();
assertPackageScript();
assertDocs();
assertSecretlessTemplate();
assertProxyContract();
assertComposeTemplates();
assertBackendSyntheticConfig();
assertNoProductionContactInLocalPackage();

if (failures.length > 0) {
  for (const failure of failures) console.error(`operator-managed-production-package-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "operator-managed-production-package-verify-ok",
      admin_ui_state: currentStatus,
      prior_status_dashboard_state: packageStatus,
      rollback_baseline: "operator-managed",
      server_deployment: "operator-managed",
      production_contact: false,
      real_secret_use: false,
      registry_publication: false
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
    ".docs/live-status-dashboard-acceptance.md",
    ".docs/admin-auth-production-operator-handoff.md",
    "deploy/production/compose.yaml",
    "deploy/production/compose.backend-network.yaml",
    "deploy/production/operator-managed.env.template",
    "deploy/production/backend-admin-auth.env.template",
    "nginx.conf",
    "docker-entrypoint.sh",
    "scripts/operator-managed-production-package-verify.mjs",
    "scripts/production-upstream-contract-verify.mjs",
    "scripts/operator-ergonomics-verify.mjs",
    "scripts/production-overlay-canonicalization-harness.mjs",
    "scripts/live-evidence-intake-verify.mjs",
    "scripts/status-api-upstream-remediation-harness.mjs",
    "scripts/production-mode-rc.mjs",
    ".docs/status-api-upstream-remediation.md",
    "../rss-habersoft-com/.docs/admin-auth-production-activation.md",
    "../rss-habersoft-com/scripts/admin-auth-provisioning.mjs"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScript() {
  const pkg = JSON.parse(readFrontend("package.json"));
  if (pkg.scripts?.["verify:operator-managed-production-package"] !== "node scripts/operator-managed-production-package-verify.mjs") {
    failures.push("package.json missing verify:operator-managed-production-package");
  }
  if (pkg.scripts?.["verify:production-upstream-contract"] !== "node scripts/production-upstream-contract-verify.mjs") {
    failures.push("package.json missing verify:production-upstream-contract");
  }
  if (pkg.scripts?.["verify:production-auth-acceptance"] !== "node scripts/production-auth-acceptance-verify.mjs") {
    failures.push("package.json missing verify:production-auth-acceptance");
  }
  if (pkg.scripts?.["verify:live-evidence-intake"] !== "node scripts/live-evidence-intake-verify.mjs") {
    failures.push("package.json missing verify:live-evidence-intake");
  }
  if (pkg.scripts?.["verify:admin-auth-not-configured-remediation"] !== "node scripts/live-evidence-intake-verify.mjs") {
    failures.push("package.json missing verify:admin-auth-not-configured-remediation");
  }
  if (pkg.scripts?.["verify:operator-ergonomics"] !== "node scripts/operator-ergonomics-verify.mjs") {
    failures.push("package.json missing verify:operator-ergonomics");
  }
  if (pkg.scripts?.["verify:production-overlay-canonicalization"] !== "node scripts/production-overlay-canonicalization-harness.mjs") {
    failures.push("package.json missing verify:production-overlay-canonicalization");
  }
  if (pkg.scripts?.["test:status-api-upstream-remediation"] !== "node scripts/status-api-upstream-remediation-harness.mjs") {
    failures.push("package.json missing test:status-api-upstream-remediation");
  }
  if (pkg.scripts?.["test:status-api-production-networking"] !== "node scripts/status-api-upstream-remediation-harness.mjs") {
    failures.push("package.json missing test:status-api-production-networking");
  }
}

function assertDocs() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readFrontend(".docs/status-api-upstream-remediation.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend(".docs/admin-auth-production-activation.md")
  ].join("\n");

  for (const fragment of [
    packageStatus,
    "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "AUTH_CONFIGURED_UNAUTHENTICATED",
    "AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
    "codex_public_readonly_verified",
    "operator_reported",
    "operator-reported authenticated admin shell",
    "rollback baseline is operator-managed",
    "server deployment/configuration is operator-managed",
    "no production deployment",
    "public read-only GET verification",
    "no registry",
    "no Git tag",
    "ADMIN_UI_AUTH_MODE",
    "ADMIN_UI_ADMIN_USERNAME",
    "ADMIN_UI_ADMIN_PASSWORD_HASH",
    "ADMIN_UI_SESSION_SECRET",
    "ADMIN_UI_SESSION_COOKIE_SECURE",
    "backend-admin-auth.env.template",
    "Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth",
    "backend runtime admin-auth env placement",
    "backend API restart/recreate",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "/status-api/health/live",
    "/status-api/health/ready",
    "/admin-auth/session",
    "/admin-auth/login",
    "/admin-auth/logout",
    "operator-managed.env.template",
    "verify:live-evidence-intake",
    "verify:admin-auth-not-configured-remediation",
    "internal backend origin",
    "https://rss.habersoft.com",
    "http://host.docker.internal:3200",
    "http://main-service-api:3000",
    "container-loopback upstream misconfiguration",
    "Do not use 127.0.0.1",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>",
    "compose.backend-network.yaml",
    "test:status-api-production-networking",
    "verify:operator-ergonomics",
    "verify:production-overlay-canonicalization",
    "verify:production-auth-acceptance",
    "ops:compose:config",
    "ops:compose:up",
    "graduated guardrails",
    "invalid_upstream_origin",
    "public_edge_upstream_rejected",
    "npm run ops:compose:ps",
    "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing ${fragment}`);
  }

  const forbiddenClaims = [
    /\badmin UI\s+(?:is|has been)\s+production active\b/iu,
    /\brss-admin-ui\b[^\n]{0,80}\b(?:is|has been)\s+deployed\b/iu,
    /\blive production acceptance\s+(?:passed|complete)\b/iu
  ];
  for (const pattern of forbiddenClaims) {
    if (pattern.test(docs)) failures.push(`docs contain forbidden production-active claim: ${pattern}`);
  }
}

function assertSecretlessTemplate() {
  const template = readFrontend("deploy/production/operator-managed.env.template");
  const backendTemplate = readFrontend("deploy/production/backend-admin-auth.env.template");
  const frontendAssignments = parseEnvAssignments(template);
  const backendAssignments = parseEnvAssignments(backendTemplate);
  for (const fragment of [
    "RSS_ADMIN_UI_IMAGE=<immutable-admin-ui-image-identity>",
    "ADMIN_UI_HOST_PORT=8081",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>",
    "Preferred backend-network service DNS mode",
    "Host-gateway mode is allowed only after the operator proves reachability",
    "Do not set ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "Do not set ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "Do not set ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200",
    "Do not set ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://main-service-api:3000",
    "ADMIN_UI_ENVIRONMENT_NAME=production",
    "backend-admin-auth.env.template",
    "does not enable backend auth",
    "HTTP 501 not_configured",
    "keep ADMIN_UI_HEALTH_UPSTREAM_ORIGIN unchanged"
  ]) {
    if (!template.includes(fragment)) failures.push(`operator template missing ${fragment}`);
  }

  for (const name of [
    "ADMIN_UI_AUTH_MODE",
    "ADMIN_UI_ADMIN_USERNAME",
    "ADMIN_UI_ADMIN_PASSWORD_HASH",
    "ADMIN_UI_SESSION_SECRET",
    "ADMIN_UI_SESSION_TTL_SECONDS",
    "ADMIN_UI_SESSION_COOKIE_NAME",
    "ADMIN_UI_SESSION_COOKIE_SECURE",
    "ADMIN_UI_SESSION_REDIS_PREFIX"
  ]) {
    if (name in frontendAssignments) failures.push(`frontend operator template must not actively assign backend-only ${name}`);
    if (!(name in backendAssignments)) failures.push(`backend admin-auth template missing ${name}`);
  }

  for (const fragment of [
    "ADMIN_UI_AUTH_MODE=single_admin",
    "ADMIN_UI_ADMIN_USERNAME=<operator-provided-admin-username>",
    "ADMIN_UI_ADMIN_PASSWORD_HASH=<operator-generated-pbkdf2-hash>",
    "ADMIN_UI_SESSION_SECRET=<operator-generated-session-secret>",
    "ADMIN_UI_SESSION_COOKIE_SECURE=true",
    "ADMIN_UI_SESSION_REDIS_PREFIX=admin_auth:production",
    "backend API service runtime",
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "not to keep changing ADMIN_UI_HEALTH_UPSTREAM_ORIGIN"
  ]) {
    if (!backendTemplate.includes(fragment)) failures.push(`backend admin-auth template missing ${fragment}`);
  }

  if (/password\s*=\s*[^<\s][^\n]*/iu.test(template) || /password\s*=\s*[^<\s][^\n]*/iu.test(backendTemplate)) {
    failures.push("operator template contains a non-placeholder password assignment");
  }
}

function assertProxyContract() {
  const nginx = readFrontend("nginx.conf");
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const runtimeTemplate = `${nginx}\n${entrypoint}`;
  for (const fragment of [
    "location = /status-api/health/live",
    "location = /status-api/health/ready",
    "location ^~ /status-api/",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "add_header Cache-Control \"no-store, no-cache, must-revalidate\" always;"
  ]) {
    if (!runtimeTemplate.includes(fragment)) failures.push(`runtime health proxy missing ${fragment}`);
  }

  for (const fragment of [
    "location = /admin-auth/session",
    "location = /admin-auth/login",
    "location = /admin-auth/logout",
    "location ^~ /admin-auth/",
    "proxy_set_header Cookie \\$http_cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "set \\$args \"\";",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`admin auth proxy template missing ${fragment}`);
  }

  if (!entrypoint.includes("if (\\$request_method != GET)") || !entrypoint.includes("if (\\$request_method != POST)")) {
    failures.push("admin auth proxy does not document method rejection");
  }
}

function assertComposeTemplates() {
  const inspectionCompose = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
    cwd: frontendRoot
  });
  if (inspectionCompose.status !== 0) failures.push("frontend production compose template failed without env file inspection defaults");

  const frontendCompose = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
    cwd: frontendRoot,
    env: {
      RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
      ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
      ADMIN_UI_ENVIRONMENT_NAME: "production-package-local",
      ADMIN_UI_HOST_PORT: "8081"
    }
  });
  if (frontendCompose.status !== 0) failures.push("frontend production compose template failed with synthetic env");

  const backendNetworkCompose = run(
    "docker",
    [
      "compose",
      "-f",
      path.join("deploy", "production", "compose.yaml"),
      "-f",
      path.join("deploy", "production", "compose.backend-network.yaml"),
      "config",
      "--quiet"
    ],
    {
      cwd: frontendRoot,
      env: {
        RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
        ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
        ADMIN_UI_ENVIRONMENT_NAME: "production-package-local",
        ADMIN_UI_HOST_PORT: "8081",
        ADMIN_UI_BACKEND_DOCKER_NETWORK: "main-service-production_default"
      }
    }
  );
  if (backendNetworkCompose.status !== 0) failures.push("frontend backend-network compose overlay failed with synthetic env");

  const rootCompose = run("docker", ["compose", "config", "--quiet"], {
    cwd: repoRoot,
    env: {
      RSS_HABERSOFT_COM_IMAGE: "main-service-app:ms023d-local",
      RSS_ADMIN_UI_IMAGE: "rss-admin-ui:ms023d-local",
      POSTGRES_USER: "main_service",
      POSTGRES_PASSWORD: "main_service_local_password",
      POSTGRES_DB: "main_service",
      DATABASE_URL: "postgresql://main_service:main_service_local_password@postgres:5432/main_service?schema=public",
      REDIS_URL: "redis://redis:6379/0",
      ADMIN_UI_AUTH_MODE: "single_admin",
      ADMIN_UI_ADMIN_USERNAME: "synthetic",
      ADMIN_UI_ADMIN_PASSWORD_HASH: "pbkdf2-sha256$120000$bXMwMjNhLXIyLXBhY2thZ2Utc2FsdC0wMA$kIDFpLaX3lmgcOPk3F7v4BA4CvFutkhDEQ199HSlZlQ",
      ADMIN_UI_SESSION_SECRET: "synthetic_ms023d_operator_package_secret_48_bytes_minimum",
      ADMIN_UI_SESSION_TTL_SECONDS: "900",
      ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
      ADMIN_UI_SESSION_COOKIE_SECURE: "false",
      ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:ms023d",
      ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
      ADMIN_UI_ENVIRONMENT_NAME: "operator-package-local",
      ADMIN_UI_HOST_PORT: "8081"
    }
  });
  if (rootCompose.status !== 0) failures.push("root compose template failed with synthetic admin UI env");
}

function assertBackendSyntheticConfig() {
  const synthetic = run("npm", ["run", "admin-auth:verify-config", "--", "--synthetic", "--require-enabled"], {
    cwd: backendRoot
  });
  if (synthetic.status !== 0) failures.push("backend synthetic admin auth config verifier failed");
  if (/synthetic-ms022b-admin-password|synthetic_ms022b_admin_session_secret|synthetic-ms023a-r2-admin-password|synthetic_ms023a_r2_admin_session_secret|synthetic-ms023b-admin-password|synthetic_ms023b_admin_session_secret|synthetic-ms023c-admin-password|synthetic_ms023c_admin_session_secret|synthetic-ms023d-admin-password|synthetic_ms023d_admin_session_secret/iu.test(synthetic.stdout + synthetic.stderr)) {
    failures.push("backend synthetic config verifier printed sensitive material");
  }

  const upstreamContract = run("npm", ["run", "verify:production-upstream-contract"], {
    cwd: frontendRoot
  });
  if (upstreamContract.status !== 0) failures.push("production upstream contract verifier failed");
}

function assertNoProductionContactInLocalPackage() {
  const files = [
    "scripts/production-mode-rc.mjs",
    "scripts/production-activation-package-verify.mjs",
    "scripts/production-upstream-contract-verify.mjs",
    "scripts/status-api-upstream-remediation-harness.mjs",
    "scripts/auth-proxy-harness.mjs",
    "scripts/proxy-security-harness.mjs",
    "scripts/auth-session-sentinel-harness.mjs"
  ];
  const forbiddenCommand = /\b(ssh|scp|sftp|rsync)\b|curl\s+https:\/\/rss|Invoke-WebRequest\s+.*https:\/\/rss|fetch\s*\(\s*["']https:\/\/rss/iu;
  for (const file of files) {
    const text = readFrontend(file);
    if (forbiddenCommand.test(text)) failures.push(`local package verifier/harness contains production contact command: ${file}`);
  }
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

function parseEnvAssignments(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?<name>[A-Z0-9_]+)=(?<value>.*)$/u.exec(line);
    if (match?.groups === undefined) continue;
    values[match.groups.name] = match.groups.value.trim();
  }
  return values;
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args);
  return spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd ?? frontendRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });
}

function resolveCommand(command, args) {
  if (command === "npm" && process.env.npm_execpath !== undefined) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  if (command === "npm" && process.platform === "win32") {
    const npmCli = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) return { executable: process.execPath, args: [npmCli, ...args] };
  }
  return { executable: command, args };
}
