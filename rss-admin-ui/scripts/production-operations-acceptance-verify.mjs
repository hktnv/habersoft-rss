import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const ms025aStatus = "MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const r1Status = "MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED";
const ms024fStatus = "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED";
const configuredUnauthenticated = "AUTH_CONFIGURED_UNAUTHENTICATED";
const loginAttemptFailed = "AUTH_LOGIN_ATTEMPT_FAILED";
const route = "/admin-api/operations/summary";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertDocsContract();
assertAuthSmokeContract();
assertAdminApiProxyFailClosed();
assertNoUnsafeTrackedClaims();
assertNoTemporaryWorkplaceOperatorInstructions();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-operations-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-operations-acceptance-verify-ok",
      milestone: status,
      evidence_source: "operator_reported",
      status_dashboard: "accepted",
      authenticated_admin_shell: "accepted_operator_reported",
      read_only_operations_dashboard: "accepted_operator_reported",
      admin_api_proxy_template_remediation: "accepted_operator_reported",
      auth_configured_unauthenticated_without_credentials: "observation_not_blocker",
      auth_login_attempt_failed_with_credentials: "blocker",
      admin_api_fail_closed_json_before_spa: true,
      production_contact: false,
      codex_credentialed_login: false,
      production_mutation: false,
      real_secret_use: false
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "../README.md",
    "../PRODUCTION.md",
    "README.md",
    "PRODUCTION.md",
    "package.json",
    "nginx.conf",
    "docker-entrypoint.sh",
    ".docs/admin-operations-dashboard.md",
    ".docs/admin-auth-production-operator-handoff.md",
    ".docs/production-activation-package.md",
    ".docs/live-status-dashboard-acceptance.md",
    "scripts/admin-auth-smoke.mjs",
    "scripts/admin-auth-smoke-harness.mjs",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/admin-operations-dashboard-verify.mjs",
    "scripts/production-operations-acceptance-verify.mjs",
    "../rss-habersoft-com/README.md",
    "../rss-habersoft-com/PRODUCTION.md",
    "../rss-habersoft-com/.docs/admin-auth-production-activation.md",
    "../rss-habersoft-com/.docs/admin-operations-summary-api.md",
    "../rss-habersoft-com/test/admin-api/admin-operations-summary.controller.spec.ts"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "verify:production-operations-acceptance": "node scripts/production-operations-acceptance-verify.mjs",
    "verify:admin-operations-dashboard": "node scripts/admin-operations-dashboard-verify.mjs",
    "verify:production-auth-acceptance": "node scripts/production-auth-acceptance-verify.mjs",
    "auth-smoke:redacted": "node scripts/admin-auth-smoke.mjs",
    "test:admin-auth-smoke-redacted": "node scripts/admin-auth-smoke-harness.mjs",
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "ops:compose:recreate": "node scripts/production-compose-ops.mjs recreate"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertDocsContract() {
  const docs = docsText();
  const requiredFragments = [
    status,
    ms025aStatus,
    r1Status,
    ms024fStatus,
    configuredUnauthenticated,
    loginAttemptFailed,
    "operator_reported",
    "operator-reported",
    "Codex did not independently perform a credentialed production login",
    "Codex did not independently perform a credentialed login",
    "no production mutation",
    "No current MS-025A/R1 operator retest residual remains",
    "read-only operations dashboard production acceptance is closed",
    "admin-api production proxy/template remediation is accepted",
    "status dashboard production scope remains accepted",
    "authenticated admin shell production scope remains accepted",
    "future business/admin write features are not accepted",
    "write/business features remain separate bounded milestones",
    "GET /healthz -> 200 OK",
    "GET /status-api/health/live -> JSON 200",
    "GET /status-api/health/ready -> JSON 200",
    `unauthenticated \`GET ${route} -> JSON 401`,
    "unknown `GET /admin-api/foo -> JSON 404",
    "after browser sign-in, the Operations Overview screen displayed successfully",
    "after browser sign-in, JSON aggregate summary data loaded successfully",
    "auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED",
    "logout returned the UI to locked / unauthenticated state",
    "without credentials is an observation/sanity result, not a pending blocker",
    "Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load",
    "`AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails",
    "credentials must be environment variables only and must not be logged",
    "must remain JSON fail-closed before the SPA fallback",
    "unknown `/admin-api/*` must not fall back to `index.html`",
    "npm run ops:compose:recreate",
    "npm run auth-smoke:redacted",
    "browser login/logout sanity",
    "`/admin-api/operations/summary` unauthenticated and authenticated checks",
    "durable operator-state receipt outside Git",
    "temporary workplace paths are not durable operator artifacts"
  ];

  for (const fragment of requiredFragments) {
    if (!docs.includes(fragment)) failures.push(`docs missing R2 fragment: ${fragment}`);
  }
}

function assertAuthSmokeContract() {
  const smoke = readFrontend("scripts/admin-auth-smoke.mjs");
  const harness = readFrontend("scripts/admin-auth-smoke-harness.mjs");
  for (const fragment of [
    configuredUnauthenticated,
    loginAttemptFailed,
    "login_smoke_pending",
    "classification === \"AUTH_CONFIGURED_UNAUTHENTICATED\"",
    "classification === \"AUTH_LOGIN_ATTEMPT_FAILED\"",
    "ADMIN_AUTH_SMOKE_USERNAME",
    "ADMIN_AUTH_SMOKE_PASSWORD",
    "credentials must be supplied through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD, not command-line arguments",
    "diagnostics are redacted and do not print credential values"
  ]) {
    if (!smoke.includes(fragment)) failures.push(`auth smoke missing ${fragment}`);
  }

  for (const fragment of [
    "configured-unauthenticated",
    "invalid-credentials",
    configuredUnauthenticated,
    loginAttemptFailed,
    "CLI credential args should fail closed",
    "should not attempt login without env credentials",
    "should report login_smoke_pending"
  ]) {
    if (!harness.includes(fragment)) failures.push(`auth smoke harness missing ${fragment}`);
  }
}

function assertAdminApiProxyFailClosed() {
  const nginx = readFrontend("nginx.conf");
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const harness = readFrontend("scripts/admin-api-proxy-template-harness.mjs");

  for (const fragment of [
    "__ADMIN_UI_ADMIN_API_ROUTES__",
    "location = /admin-api",
    "location ^~ /admin-api/",
    "location / {"
  ]) {
    if (!nginx.includes(fragment)) failures.push(`nginx template missing ${fragment}`);
  }

  const markerIndex = nginx.indexOf("__ADMIN_UI_ADMIN_API_ROUTES__");
  const exactFallbackIndex = nginx.indexOf("location = /admin-api");
  const prefixFallbackIndex = nginx.indexOf("location ^~ /admin-api/");
  const spaFallbackIndex = nginx.indexOf("location / {");
  if (!(markerIndex !== -1 && exactFallbackIndex !== -1 && prefixFallbackIndex !== -1 && spaFallbackIndex !== -1)) {
    failures.push("nginx route order proof could not locate admin-api marker/fallback/SPA routes");
  } else {
    if (!(markerIndex < spaFallbackIndex)) failures.push("admin-api generated marker is after SPA fallback");
    if (!(exactFallbackIndex < spaFallbackIndex)) failures.push("exact /admin-api fallback is after SPA fallback");
    if (!(prefixFallbackIndex < spaFallbackIndex)) failures.push("/admin-api/ fallback is after SPA fallback");
  }

  for (const fragment of [
    `location = ${route}`,
    "admin_api_static_routes",
    "admin_api_degraded_routes",
    "admin_api_proxy_routes",
    "generated Nginx config is missing /admin-api/operations/summary",
    "generated Nginx config is missing admin-api fallback rejection routes",
    "error_page 401 403 = @admin_api_unauthenticated;",
    "error_page 500 502 504 = @admin_api_unavailable;",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;",
    "set \\$args \"\";",
    "proxy_set_header Cookie \\$http_cookie;",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "proxy_hide_header Access-Control-Allow-Origin;"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`entrypoint missing ${fragment}`);
  }

  for (const fragment of [
    "/tmp/nginx/conf.d/default.conf",
    "nginx -T",
    "location = /admin-api/operations/summary",
    "location\\s*=\\s*\\/admin-api",
    "location\\s*\\^~\\s*\\/admin-api\\/",
    "fell through to SPA HTML",
    "unknown /admin-api path",
    "unauthenticated admin-api summary",
    "assertAdminApiJson(results.unknownAdminApiPrefix, 404",
    "assertAdminApiJson(results.unauthenticatedSummary, 401"
  ]) {
    if (!harness.includes(fragment)) failures.push(`admin-api template harness missing ${fragment}`);
  }
}

function assertNoUnsafeTrackedClaims() {
  const docs = docsText();
  const forbiddenClaims = [
    /\bCodex (?:logged in|performed a credentialed production login|performed a credentialed login|used real admin credentials)\b/iu,
    /\bwe (?:logged in|used real admin credentials)\b/iu,
    /\b(?:admin write|write\/business|business\/admin write|feed editing|tenant management|user management)\s+features\s+(?:are|were|have been)\s+accepted\b/iu,
    /\bregistry(?:\/image)? publication\s+(?:was|is|has been)\s+(?:performed|completed|accepted)\b/iu,
    /\bCodex (?:deployed|restarted|recreated|mutated)\s+production\b/iu,
    /\blong-term stability\b[^\n]{0,80}\b(?:proposed|required|performed)\b/iu
  ];
  for (const pattern of forbiddenClaims) {
    if (pattern.test(docs)) failures.push(`docs contain forbidden R2 overclaim: ${pattern}`);
  }
}

function assertNoTemporaryWorkplaceOperatorInstructions() {
  for (const file of trackedMarkdownFiles()) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/");
    const text = readFileSync(file, "utf8");
    if (/E:\\Codex\\rss-habersoft-com\\workplace\\ms-[^\s`]+/iu.test(text)) {
      failures.push(`temporary workplace path presented in tracked docs: ${relative}`);
    }
    if (/C:\\Users\\EVO-MRDM\\Desktop\\[^`\s]+/iu.test(text) && !/historical|forbidden|do-not-use|do not use/iu.test(text)) {
      failures.push(`Desktop path presented as active tracked-doc instruction: ${relative}`);
    }
  }
}

function docsText() {
  return [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-auth-production-activation.md"),
    readBackend(".docs/admin-operations-summary-api.md")
  ].join("\n");
}

function trackedMarkdownFiles() {
  return [
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "PRODUCTION.md"),
    path.join(frontendRoot, "README.md"),
    path.join(frontendRoot, "PRODUCTION.md"),
    ...collectMarkdown(path.join(frontendRoot, ".docs")),
    path.join(backendRoot, "README.md"),
    path.join(backendRoot, "PRODUCTION.md"),
    ...collectMarkdown(path.join(backendRoot, ".docs"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());
}

function collectMarkdown(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectMarkdown(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
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
