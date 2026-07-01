import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

const requiredFiles = [
  "README.md",
  "PRODUCTION.md",
  ".docs/production-activation-package.md",
  ".docs/live-status-dashboard-acceptance.md",
  ".docs/admin-auth-production-operator-handoff.md",
  "deploy/production/operator-managed.env.template",
  "deploy/production/backend-admin-auth.env.template",
  "deploy/production/compose.backend-network.yaml",
  "scripts/production-mode-rc.mjs",
  "scripts/production-activation-package-verify.mjs",
  "scripts/operator-managed-production-package-verify.mjs",
  "scripts/production-upstream-contract-verify.mjs",
  "scripts/operator-ergonomics-verify.mjs",
  "scripts/production-overlay-canonicalization-harness.mjs",
  "scripts/live-evidence-intake-verify.mjs",
  "scripts/production-operations-acceptance-verify.mjs",
  "scripts/status-api-upstream-remediation-harness.mjs",
  "scripts/admin-api-proxy-template-harness.mjs",
  ".docs/status-api-upstream-remediation.md",
  "../rss-habersoft-com/scripts/admin-auth-provisioning.mjs",
  "../rss-habersoft-com/.docs/admin-auth-production-activation.md"
];

for (const file of requiredFiles) requireFile(file);
assertPackageScripts();
assertDocsBoundary();
assertBackendProvisioningScripts();
assertBrowserSurface();
assertProductionComposeTemplates();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-activation-package-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-activation-package-verify-ok",
      admin_ui_state: "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED",
      prior_operations_summary_state: "MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED",
      authenticated_admin_shell_state: "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
      prior_status_dashboard_state: "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED",
      provisioning_helpers: "present",
      local_rc_harness: "present",
      operator_managed_package: "present",
      upstream_remediation_package: "present",
      live_evidence_intake: "present",
      production_contact: false,
      registry_publication: false
    },
    null,
    2
  )
);

function assertPackageScripts() {
  const frontendPackage = JSON.parse(readFrontend("package.json"));
  const backendPackage = JSON.parse(readBackend("package.json"));
  const frontendScripts = frontendPackage.scripts ?? {};
  const backendScripts = backendPackage.scripts ?? {};
  const requiredFrontend = {
    "verify:production-activation-package": "node scripts/production-activation-package-verify.mjs",
    "verify:operator-managed-production-package": "node scripts/operator-managed-production-package-verify.mjs",
    "verify:production-upstream-contract": "node scripts/production-upstream-contract-verify.mjs",
    "verify:production-auth-acceptance": "node scripts/production-auth-acceptance-verify.mjs",
    "verify:production-operations-acceptance": "node scripts/production-operations-acceptance-verify.mjs",
    "verify:production-operations-drilldown-acceptance": "node scripts/production-operations-drilldown-acceptance-verify.mjs",
    "verify:operator-ergonomics": "node scripts/operator-ergonomics-verify.mjs",
    "verify:production-overlay-canonicalization": "node scripts/production-overlay-canonicalization-harness.mjs",
    "verify:live-evidence-intake": "node scripts/live-evidence-intake-verify.mjs",
    "verify:admin-auth-not-configured-remediation": "node scripts/live-evidence-intake-verify.mjs",
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "test:status-api-upstream-remediation": "node scripts/status-api-upstream-remediation-harness.mjs",
    "test:status-api-production-networking": "node scripts/status-api-upstream-remediation-harness.mjs",
    "test:production-mode-rc": "node scripts/production-mode-rc.mjs"
  };
  const requiredBackend = {
    "admin-auth:hash": "node -- scripts/admin-auth-provisioning.mjs hash",
    "admin-auth:secret": "node -- scripts/admin-auth-provisioning.mjs secret",
    "admin-auth:verify-config": "node -- scripts/admin-auth-provisioning.mjs verify-config"
  };

  for (const [name, command] of Object.entries(requiredFrontend)) {
    if (frontendScripts[name] !== command) failures.push(`frontend package.json missing ${name}`);
  }
  for (const [name, command] of Object.entries(requiredBackend)) {
    if (backendScripts[name] !== command) failures.push(`backend package.json missing ${name}`);
  }
}

function assertDocsBoundary() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readFrontend(".docs/status-api-upstream-remediation.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-auth-production-activation.md")
  ].join("\n");

  const required = [
    "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED",
    "MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING",
    "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "AUTH_CONFIGURED_UNAUTHENTICATED",
    "AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
    "codex_public_readonly_verified",
    "operator_reported",
    "operator-reported",
    "authenticated admin shell production acceptance",
    "Codex did not independently perform a credentialed login",
    "future business/admin write features are not accepted",
    "auth-smoke:redacted remains a redacted regression/sanity tool",
    "No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains",
    "rollback baseline is operator-managed",
    "server deployment/configuration is operator-managed",
    "internal backend origin",
    "https://rss.habersoft.com",
    "container-loopback upstream misconfiguration",
    "Do not use 127.0.0.1",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>",
    "compose.backend-network.yaml",
    "http://host.docker.internal:3200",
    "http://main-service-api:3000",
    "ADMIN_UI_AUTH_MODE",
    "ADMIN_UI_ADMIN_USERNAME",
    "ADMIN_UI_ADMIN_PASSWORD_HASH",
    "ADMIN_UI_SESSION_SECRET",
    "ADMIN_UI_SESSION_COOKIE_SECURE",
    "backend-admin-auth.env.template",
    "Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth",
    "backend runtime admin-auth env placement",
    "backend API restart/recreate",
    "frontend proxy recovered after canonical overlay helper recreate",
    "npm run ops:compose:recreate",
    "regression/sanity tool",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "/admin-auth/session",
    "/admin-auth/login",
    "/admin-auth/logout",
    "/status-api/health/live",
    "/status-api/health/ready",
    "same-origin",
    "no production deployment",
    "no registry",
    "no Git tag",
    "operator-authorized",
    "operator-managed.env.template",
    "verify:live-evidence-intake",
    "verify:admin-auth-not-configured-remediation",
    "verify:production-upstream-contract",
    "test:status-api-production-networking",
    "verify:operator-ergonomics",
    "verify:production-overlay-canonicalization",
    "test:admin-api-proxy-template",
    "verify:production-operations-acceptance",
    "MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED",
    "MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED",
    "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED",
    "read-only operations dashboard production acceptance is closed",
    "admin-api production proxy/template remediation is accepted",
    "/admin-api/operations/drilldown",
    "drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence",
    "No production deployment was performed by Codex for MS-025B-R1",
    "verify:production-operations-drilldown-acceptance",
    "verify:admin-operations-drilldown",
    "/tmp/nginx/conf.d/default.conf",
    "nginx -T",
    "source pull alone",
    "rebuild",
    "SPA HTML",
    "ops:compose:config",
    "ops:compose:up",
    "graduated guardrails",
    "npm run ops:compose:ps",
    "invalid_upstream_origin",
    "public_edge_upstream_rejected",
    "test:status-api-upstream-remediation"
  ];
  for (const fragment of required) {
    if (!docs.includes(fragment)) failures.push(`docs missing ${fragment}`);
  }

  const forbiddenClaims = [
    /\brss-admin-ui\b[^\n]{0,80}\b(?:is|has been)\s+deployed\b/iu,
    /\badmin UI\s+(?:is|has been)\s+production active\b/iu,
    /\bproduction admin auth\s+(?:is|has been)\s+enabled\b/iu
  ];
  for (const pattern of forbiddenClaims) {
    if (pattern.test(docs)) {
      failures.push(`docs contain a forbidden production-active claim: ${pattern}`);
    }
  }
}

function assertBackendProvisioningScripts() {
  const synthetic = run("npm", ["run", "admin-auth:verify-config", "--", "--synthetic", "--require-enabled"], {
    cwd: backendRoot
  });
  if (synthetic.status !== 0) failures.push("backend synthetic admin auth config verifier failed");
  if (/synthetic-ms022b-admin-password|synthetic_ms022b_admin_session_secret|synthetic-ms023a-r2-admin-password|synthetic_ms023a_r2_admin_session_secret|synthetic-ms023b-admin-password|synthetic_ms023b_admin_session_secret|synthetic-ms023c-admin-password|synthetic_ms023c_admin_session_secret|synthetic-ms023d-admin-password|synthetic_ms023d_admin_session_secret/iu.test(synthetic.stdout + synthetic.stderr)) {
    failures.push("backend config verifier printed synthetic secret material");
  }
}

function assertBrowserSurface() {
  const files = [
    ...collectFiles(path.join(frontendRoot, "src")),
    ...collectFiles(path.join(frontendRoot, "public")),
    path.join(frontendRoot, "index.html"),
    ...collectFiles(path.join(frontendRoot, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());

  const forbidden = [
    { label: "agent key header", pattern: /X-Agent-Key/iu },
    { label: "agent key env", pattern: /AGENT_KEY\s*=/u },
    { label: "tenant bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "server upstream origin env", pattern: /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u },
    { label: "local compose upstream", pattern: /main-service-api:3000/u },
    { label: "synthetic password", pattern: /synthetic-ms022b-admin-password|synthetic-ms023a-r2-admin-password|synthetic-ms023b-admin-password|synthetic-ms023c-admin-password|synthetic-ms023d-admin-password/u },
    { label: "synthetic session secret", pattern: /synthetic_ms022b_admin_session_secret|synthetic_ms023a_r2_admin_session_secret|synthetic_ms023b_admin_session_secret|synthetic_ms023c_admin_session_secret|synthetic_ms023d_admin_session_secret/u },
    { label: "private key", pattern: /BEGIN (?:RSA )?PRIVATE KEY/u }
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const check of forbidden) {
      if (check.pattern.test(text)) {
        failures.push(`${check.label} in browser source/build: ${path.relative(frontendRoot, file)}`);
        break;
      }
    }
  }
}

function assertProductionComposeTemplates() {
  const env = {
    RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_ENVIRONMENT_NAME: "production-activation-package-local",
    ADMIN_UI_HOST_PORT: "8081"
  };
  const result = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
    cwd: frontendRoot,
    env
  });
  if (result.status !== 0) failures.push("frontend production compose template did not render with synthetic env");

  const overlay = run(
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
        ...env,
        ADMIN_UI_BACKEND_DOCKER_NETWORK: "main-service-production_default"
      }
    }
  );
  if (overlay.status !== 0) failures.push("frontend backend-network production compose overlay did not render with synthetic env");
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd ?? frontendRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });
  return result;
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

function requireFile(relative) {
  const absolute = path.resolve(frontendRoot, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) failures.push(`missing required file: ${relative}`);
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

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}
