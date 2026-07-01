import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const acceptedSummaryStatus = "MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const route = "/admin-api/operations/drilldown";
const summaryRoute = "/admin-api/operations/summary";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertFrontendContract();
assertBackendContract();
assertProxyContract();
assertDocsContract();
assertBrowserSafety();

if (failures.length > 0) {
  for (const failure of failures) console.error(`admin-operations-drilldown-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "admin-operations-drilldown-verify-ok",
      milestone: status,
      prior_operations_summary_acceptance: acceptedSummaryStatus,
      routes: [summaryRoute, route],
      same_origin: true,
      read_only: true,
      manual_refresh_only: true,
      generated_config_proof: "npm run test:admin-api-proxy-template",
      production_contact: false,
      production_acceptance_claimed: "operator_reported"
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "src/adminOperations/operationsDrilldownClient.ts",
    "src/adminOperations/OperationsDrilldown.tsx",
    "src/adminOperations/OperationsOverview.tsx",
    "src/auth/adminSessionBoundary.ts",
    "tests/operations-drilldown-client.test.ts",
    "tests/operations-drilldown.test.tsx",
    "tests/app-shell.test.tsx",
    "tests/security-boundary.test.ts",
    "scripts/auth-proxy-harness.mjs",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/admin-operations-drilldown-verify.mjs",
    ".docs/admin-operations-dashboard.md",
    "README.md",
    "PRODUCTION.md",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/src/admin-api/admin-api.module.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-drilldown.service.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-drilldown.types.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.controller.ts",
    "../rss-habersoft-com/test/admin-api/admin-operations-drilldown.controller.spec.ts",
    "../rss-habersoft-com/.docs/admin-operations-drilldown-api.md"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "verify:admin-operations-drilldown": "node scripts/admin-operations-drilldown-verify.mjs",
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "test:admin-operations-proxy": "node scripts/auth-proxy-harness.mjs",
    "test:fullstack": "node scripts/root-fullstack-acceptance.mjs",
    "test:production-mode-rc": "node scripts/production-mode-rc.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertFrontendContract() {
  const client = readFrontend("src/adminOperations/operationsDrilldownClient.ts");
  const component = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  const overview = readFrontend("src/adminOperations/OperationsOverview.tsx");
  const boundary = readFrontend("src/auth/adminSessionBoundary.ts");
  const tests = [
    readFrontend("tests/operations-drilldown-client.test.ts"),
    readFrontend("tests/operations-drilldown.test.tsx"),
    readFrontend("tests/app-shell.test.tsx"),
    readFrontend("tests/security-boundary.test.ts")
  ].join("\n");

  for (const fragment of [
    `ADMIN_OPERATIONS_DRILLDOWN_PATH = "${route}"`,
    'method: "GET"',
    'credentials: "same-origin"',
    'cache: "no-store"',
    'redirect: "manual"',
    'Accept: "application/json"',
    "browserPersistence: false",
    "customCredentialHeaders: false",
    "queryForwarding: false",
    "writeMethods: false",
    "polling: false",
    "parseOperationsDrilldownResponse",
    "sourceHost",
    "maxRows"
  ]) {
    if (!client.includes(fragment)) failures.push(`operations drilldown client missing ${fragment}`);
  }

  for (const fragment of [
    "Operations Drilldown",
    "Refresh Drilldown",
    "No eligible feed recheck target is currently available.",
    "Copy redacted evidence",
    "frontend canonical helper recreate",
    route,
    "requestIdRef",
    "AbortController"
  ]) {
    if (!component.includes(fragment)) failures.push(`OperationsDrilldown missing ${fragment}`);
  }

  if (!overview.includes("<OperationsDrilldown")) failures.push("OperationsOverview does not render OperationsDrilldown");
  if (!boundary.includes(`sameOriginAdminOperationsDrilldownPath: "${route}"`)) {
    failures.push("admin session boundary missing operations drilldown path");
  }

  for (const fragment of [
    route,
    "unauthenticated",
    "unavailable",
    "invalid_response",
    "same-origin",
    "Operations Drilldown",
    "Refresh Drilldown",
    "operationsDrilldownClientContract.browserPersistence"
  ]) {
    if (!tests.includes(fragment)) failures.push(`drilldown tests missing ${fragment}`);
  }
}

function assertBackendContract() {
  const controller = readBackend("src/admin-api/admin-operations-summary.controller.ts");
  const service = readBackend("src/admin-api/admin-operations-drilldown.service.ts");
  const types = readBackend("src/admin-api/admin-operations-drilldown.types.ts");
  const module = readBackend("src/admin-api/admin-api.module.ts");
  const tests = readBackend("test/admin-api/admin-operations-drilldown.controller.spec.ts");

  for (const fragment of [
    '@Controller("admin-api/operations")',
    '@Get("drilldown")',
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
    "this.database.feed.findMany",
    "this.database.entry.count",
    "this.database.entry.findFirst",
    "this.database.agentFeedCheckEvent.findMany",
    "this.database.agentFeedCheckEvent.groupBy",
    "safeSourceHost",
    "displayId",
    "maxRows",
    "Drilldown rows are bounded",
    "unavailableFeeds",
    "unavailableIngestion"
  ]) {
    if (!service.includes(fragment)) failures.push(`drilldown service missing ${fragment}`);
  }

  for (const fragment of [
    "sourceHost",
    "displayId",
    "health",
    "lastResult",
    "recentEntryCount",
    "capabilities",
    "maxRows"
  ]) {
    if (!types.includes(fragment)) failures.push(`drilldown types missing ${fragment}`);
  }

  if (!module.includes("AdminOperationsDrilldownService")) failures.push("AdminApiModule missing drilldown service");

  for (const fragment of [
    route,
    "fails closed without admin auth configured",
    "requires an authenticated admin session",
    "bounded drilldown data",
    "keeps admin-api drilldown read-only",
    "partial safe notes",
    "not.toContain(\"https://news.example.org/feed.xml\")",
    "expectNoWrites"
  ]) {
    if (!tests.includes(fragment)) failures.push(`drilldown backend tests missing ${fragment}`);
  }
}

function assertProxyContract() {
  const nginx = readFrontend("nginx.conf");
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const authHarness = readFrontend("scripts/auth-proxy-harness.mjs");
  const templateHarness = readFrontend("scripts/admin-api-proxy-template-harness.mjs");
  const runtime = `${nginx}\n${entrypoint}`;

  for (const fragment of [
    "__ADMIN_UI_ADMIN_API_ROUTES__",
    `location = ${route}`,
    "generated Nginx config is missing /admin-api/operations/drilldown",
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
    if (!runtime.includes(fragment)) failures.push(`admin-api drilldown proxy contract missing ${fragment}`);
  }

  if (/location\s+\^~\s+\/admin-api\/[\s\S]*proxy_pass/iu.test(entrypoint)) {
    failures.push("entrypoint appears to proxy a broad /admin-api/ wildcard");
  }

  for (const fragment of [
    route,
    "admin operations drilldown proxy failed",
    "query string reached admin-api upstream",
    "authorization header reached admin-api upstream",
    "agent key header reached admin-api upstream",
    "session cookie was not forwarded to admin-api upstream",
    "admin operations drilldown relayed Set-Cookie"
  ]) {
    if (!authHarness.includes(fragment)) failures.push(`auth proxy harness missing drilldown fragment: ${fragment}`);
  }

  for (const fragment of [
    "/tmp/nginx/conf.d/default.conf",
    "nginx -T",
    "location = /admin-api/operations/drilldown",
    "drilldown route appears after SPA fallback",
    "fell through to SPA HTML",
    "unauthenticated admin-api drilldown",
    "unreachable admin-api upstream drilldown",
    "static no-auth-upstream admin-api drilldown"
  ]) {
    if (!templateHarness.includes(fragment)) failures.push(`admin-api template harness missing drilldown fragment: ${fragment}`);
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
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-operations-summary-api.md"),
    readBackend(".docs/admin-operations-drilldown-api.md")
  ].join("\n");

  for (const fragment of [
    status,
    acceptedSummaryStatus,
    route,
    "same-origin",
    "manual refresh",
    "no polling",
    "sourceHost",
    "displayId",
    "maxRows",
    "raw feed URL paths",
    "entry content",
    "Agent key",
    "Tenant bearer",
    "localStorage",
    "sessionStorage",
    "IndexedDB",
    "cookieStore",
    "document.cookie",
    "drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence",
    "Codex did not independently perform a credentialed production login",
    "No production deployment was performed by Codex for MS-025B-R1",
    "npm run verify:admin-operations-drilldown",
    "npm run verify:production-operations-drilldown-acceptance",
    "npm run test:admin-api-proxy-template",
    "npm run ops:compose:recreate"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-025B fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bCodex (?:logged in|performed a credentialed production login|used real admin credentials)\b/iu,
    /\bCodex (?:deployed|restarted|recreated|mutated)\s+production\b/iu,
    /\bregistry(?:\/image)? publication\s+(?:was|is|has been)\s+(?:performed|completed|accepted)\b/iu,
    /\bnew drilldown production acceptance is pending operator deploy\/retest\b/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden MS-025B claim: ${forbidden}`);
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
    { label: "server upstream origin env", pattern: /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u, sourceOnly: false },
    { label: "internal upstream origin", pattern: /main-service-api:3000|host\.docker\.internal:3200|127\.0\.0\.1:3200/iu, sourceOnly: false },
    { label: "agent key header/env", pattern: /X-Agent-Key|AGENT_KEY\s*=/iu, sourceOnly: false },
    { label: "hardcoded bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu, sourceOnly: false },
    { label: "session secret", pattern: /ADMIN_UI_SESSION_SECRET|session_secret/iu, sourceOnly: false },
    { label: "password hash", pattern: /ADMIN_UI_ADMIN_PASSWORD_HASH|pbkdf2-sha256\$/iu, sourceOnly: false },
    { label: "browser credential persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u, sourceOnly: false },
    { label: "raw feed URL path in drilldown source", pattern: /sourceHost[^;\n]+https?:\/\//iu, sourceOnly: false },
    { label: "dangerous html rendering", pattern: /dangerouslySetInnerHTML/u, sourceOnly: true }
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file)) continue;
    const relative = path.relative(frontendRoot, file);
    const isBuiltAsset = relative === "dist" || relative.startsWith(`dist${path.sep}`);
    const text = readFileSync(file, "utf8");
    for (const check of forbidden) {
      if (check.sourceOnly && isBuiltAsset) continue;
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
