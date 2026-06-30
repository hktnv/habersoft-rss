import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const r1Status = "MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED";
const route = "/admin-api/operations/summary";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertFrontendContract();
assertBackendContract();
assertProxyContract();
assertDocsContract();
assertBrowserSafety();

if (failures.length > 0) {
  for (const failure of failures) console.error(`admin-operations-dashboard-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "admin-operations-dashboard-verify-ok",
      milestone: status,
      remediation_milestone: r1Status,
      route,
      same_origin: true,
      read_only: true,
      production_contact: false,
      real_secret_use: false,
      operator_deploy_retest_required: true
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "src/adminOperations/operationsSummaryClient.ts",
    "src/adminOperations/OperationsOverview.tsx",
    "src/App.tsx",
    "src/auth/adminSessionBoundary.ts",
    "tests/operations-summary-client.test.ts",
    "tests/operations-overview.test.tsx",
    "tests/app-shell.test.tsx",
    "tests/security-boundary.test.ts",
    "scripts/auth-proxy-harness.mjs",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/admin-operations-dashboard-verify.mjs",
    ".docs/admin-operations-dashboard.md",
    "README.md",
    "PRODUCTION.md",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/src/admin-api/admin-api.module.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.controller.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.service.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.types.ts",
    "../rss-habersoft-com/test/admin-api/admin-operations-summary.controller.spec.ts",
    "../rss-habersoft-com/.docs/admin-operations-summary-api.md"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "test:admin-operations-proxy": "node scripts/auth-proxy-harness.mjs",
    "verify:admin-operations-dashboard": "node scripts/admin-operations-dashboard-verify.mjs",
    "test:fullstack": "node scripts/root-fullstack-acceptance.mjs",
    "test:production-mode-rc": "node scripts/production-mode-rc.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertFrontendContract() {
  const client = readFrontend("src/adminOperations/operationsSummaryClient.ts");
  const overview = readFrontend("src/adminOperations/OperationsOverview.tsx");
  const app = readFrontend("src/App.tsx");
  const boundary = readFrontend("src/auth/adminSessionBoundary.ts");
  const tests = [
    readFrontend("tests/operations-summary-client.test.ts"),
    readFrontend("tests/operations-overview.test.tsx"),
    readFrontend("tests/app-shell.test.tsx"),
    readFrontend("tests/security-boundary.test.ts")
  ].join("\n");

  for (const fragment of [
    `ADMIN_OPERATIONS_SUMMARY_PATH = "${route}"`,
    'method: "GET"',
    'credentials: "same-origin"',
    'cache: "no-store"',
    'redirect: "manual"',
    'Accept: "application/json"',
    "browserPersistence: false",
    "customCredentialHeaders: false",
    "queryForwarding: false",
    "writeMethods: false",
    "parseOperationsSummaryResponse"
  ]) {
    if (!client.includes(fragment)) failures.push(`operations summary client missing ${fragment}`);
  }

  for (const fragment of [
    "Operations Overview",
    "Read-only admin operations",
    "Protected aggregate view",
    "Refresh",
    "frontend canonical helper recreate",
    route
  ]) {
    if (!overview.includes(fragment)) failures.push(`OperationsOverview missing ${fragment}`);
  }

  if (!app.includes("<OperationsOverview />")) failures.push("App does not render OperationsOverview in the protected shell");
  if (!boundary.includes(`sameOriginAdminOperationsSummaryPath: "${route}"`)) {
    failures.push("admin session boundary missing operations summary path");
  }

  for (const fragment of [
    route,
    "unauthenticated",
    "unavailable",
    "invalid_response",
    "same-origin",
    "Operations Overview",
    "toHaveBeenCalledTimes(1)"
  ]) {
    if (!tests.includes(fragment)) failures.push(`operations tests missing ${fragment}`);
  }
}

function assertBackendContract() {
  const controller = readBackend("src/admin-api/admin-operations-summary.controller.ts");
  const service = readBackend("src/admin-api/admin-operations-summary.service.ts");
  const types = readBackend("src/admin-api/admin-operations-summary.types.ts");
  const authService = readBackend("src/admin-auth/admin-auth.service.ts");
  const apiModule = readBackend("src/api.module.ts");
  const tests = readBackend("test/admin-api/admin-operations-summary.controller.spec.ts");

  for (const fragment of [
    '@Controller("admin-api/operations")',
    '@Get("summary")',
    "this.adminAuth.session(request)",
    "reply.status(501)",
    "UnauthorizedException",
    "MethodNotAllowedException",
    "read_only_endpoint"
  ]) {
    if (!controller.includes(fragment)) failures.push(`admin operations controller missing ${fragment}`);
  }

  for (const fragment of [
    "this.database.feed.count",
    "this.database.entry.count",
    "this.database.agentFeedCheckEvent.count",
    "this.health.readiness()",
    "summary_is_aggregate_only",
    "operations_metrics_unavailable",
    "dependency_status_unavailable",
    "nullMetrics"
  ]) {
    if (!service.includes(fragment)) failures.push(`admin operations service missing ${fragment}`);
  }

  for (const fragment of [
    "dependencies",
    "feeds",
    "entries",
    "ingestion",
    "notes",
    "latestCheckAt"
  ]) {
    if (!types.includes(fragment)) failures.push(`admin operations types missing ${fragment}`);
  }

  for (const fragment of [
    '"Path=/"',
    'buildClearSessionCookie(this.config, "/admin-auth")',
    'buildClearSessionCookie(config, "/")',
    "HttpOnly",
    "SameSite=Lax"
  ]) {
    if (!authService.includes(fragment)) failures.push(`admin auth service missing cookie path contract ${fragment}`);
  }

  if (!apiModule.includes("AdminApiModule")) failures.push("ApiModule does not import AdminApiModule");

  for (const fragment of [
    route,
    "fails closed without admin auth configured",
    "requires an authenticated admin session",
    "keeps admin-api read-only",
    "logout clears root and historical admin-auth cookie paths",
    "Path=/admin-auth",
    "summary_is_aggregate_only"
  ]) {
    if (!tests.includes(fragment)) failures.push(`admin operations tests missing ${fragment}`);
  }
}

function assertProxyContract() {
  const nginx = readFrontend("nginx.conf");
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const harness = readFrontend("scripts/auth-proxy-harness.mjs");
  const templateHarness = readFrontend("scripts/admin-api-proxy-template-harness.mjs");
  const runtime = `${nginx}\n${entrypoint}`;

  for (const fragment of [
    "__ADMIN_UI_ADMIN_API_ROUTES__",
    "location = /admin-api",
    "location ^~ /admin-api/",
    "admin_api_static_routes",
    "admin_api_degraded_routes",
    "admin_api_proxy_routes",
    "generated Nginx config is missing /admin-api/operations/summary",
    `location = ${route}`,
    "if (\\$request_method != GET)",
    "set \\$args \"\";",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;",
    "proxy_set_header Cookie \\$http_cookie;",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "proxy_hide_header Access-Control-Allow-Origin;",
    "error_page 401 403 = @admin_api_unauthenticated;",
    "error_page 500 502 504 = @admin_api_unavailable;",
    `proxy_pass \\$admin_api_upstream_origin${route}?;`
  ]) {
    if (!runtime.includes(fragment)) failures.push(`admin-api proxy contract missing ${fragment}`);
  }

  for (const fragment of [
    route,
    "admin operations summary proxy failed",
    "query string reached admin-api upstream",
    "authorization header reached admin-api upstream",
    "agent key header reached admin-api upstream",
    "session cookie was not forwarded to admin-api upstream",
    "admin operations summary relayed Set-Cookie"
  ]) {
    if (!harness.includes(fragment)) failures.push(`admin operations proxy harness missing ${fragment}`);
  }

  for (const fragment of [
    "/tmp/nginx/conf.d/default.conf",
    "nginx -T",
    "location = /admin-api/operations/summary",
    "location\\s*=\\s*\\/admin-api",
    "location\\s*\\^~\\s*\\/admin-api\\/",
    "fell through to SPA HTML",
    "unreachable admin-api upstream summary",
    "static no-auth-upstream admin-api summary"
  ]) {
    if (!templateHarness.includes(fragment)) failures.push(`admin-api proxy template harness missing ${fragment}`);
  }
}

function assertDocsContract() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/api-auth-contract.md"),
    readFrontend(".docs/admin-auth-session-boundary.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-auth-production-activation.md"),
    readBackend(".docs/admin-operations-summary-api.md")
  ].join("\n");

  for (const fragment of [
    status,
    r1Status,
    "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED",
    route,
    "same-origin",
    "Path=/",
    "historical `/admin-auth`",
    "aggregate-only",
    "operator deploy/retest",
    "production deployment",
    "No production deployment",
    "no live production acceptance",
    "Tenant bearer",
    "Agent key",
    "Authorization",
    "localStorage",
    "sessionStorage",
    "IndexedDB",
    "cookieStore",
    "document.cookie",
    "no write controls",
    "npm run ops:compose:recreate",
    "npm run verify:admin-operations-dashboard",
    "npm run test:admin-operations-proxy",
    "npm run test:admin-api-proxy-template",
    "/tmp/nginx/conf.d/default.conf",
    "nginx -T",
    "source pull alone is not sufficient",
    "SPA HTML",
    "0.1.0-ms-017"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-025A fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bMS-025A\b[^\n]{0,120}\b(?:production|live)\s+acceptance\s+(?:accepted|passed|complete)\b/iu,
    /\bCodex (?:logged in|performed a credentialed login|used real admin credentials)\b/iu,
    /\bfeed\/user\/tenant management\s+(?:is|has been)\s+accepted\b/iu,
    /\bproduction deployment\s+(?:was|is)\s+performed\b/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden MS-025A claim: ${forbidden}`);
  }
}

function assertBrowserSafety() {
  const files = [
    ...collectFiles(path.join(frontendRoot, "src")),
    ...collectFiles(path.join(frontendRoot, "public")),
    path.join(frontendRoot, "index.html"),
    ...collectFiles(path.join(frontendRoot, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());

  const forbidden = [
    { label: "server upstream origin env", pattern: /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u },
    { label: "internal upstream origin", pattern: /main-service-api:3000|host\.docker\.internal:3200|127\.0\.0\.1:3200/iu },
    { label: "agent key header/env", pattern: /X-Agent-Key|AGENT_KEY\s*=/iu },
    { label: "hardcoded bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "session secret", pattern: /ADMIN_UI_SESSION_SECRET|session_secret/iu },
    { label: "password hash", pattern: /ADMIN_UI_ADMIN_PASSWORD_HASH|pbkdf2-sha256\$/iu },
    { label: "browser credential persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "private key", pattern: /BEGIN (?:RSA )?PRIVATE KEY/u }
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file)) continue;
    const relative = path.relative(frontendRoot, file);
    const text = readFileSync(file, "utf8");
    for (const check of forbidden) {
      if (check.pattern.test(text)) {
        failures.push(`${check.label} in browser source/build: ${relative}`);
        break;
      }
    }
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

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}
