import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const drilldownStatus = "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const route = "/admin-api/operations/feed-recheck-requests";
const drilldownRoute = "/admin-api/operations/drilldown";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertFrontendContract();
assertBackendContract();
assertProxyContract();
assertDocsContract();
assertBrowserSafety();

if (failures.length > 0) {
  for (const failure of failures) console.error(`admin-feed-recheck-action-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "admin-feed-recheck-action-verify-ok",
      milestone: status,
      prior_drilldown_acceptance: drilldownStatus,
      routes: [drilldownRoute, route],
      same_origin: true,
      bounded_write_action_only: true,
      csrf_required: true,
      idempotency_required: true,
      cooldown_seconds: 300,
      production_contact: false,
      production_acceptance_claimed: false
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "src/adminOperations/feedRecheckClient.ts",
    "src/adminOperations/operationsDrilldownClient.ts",
    "src/adminOperations/OperationsDrilldown.tsx",
    "src/auth/adminSessionClient.ts",
    "src/auth/adminSessionBoundary.ts",
    "tests/feed-recheck-client.test.ts",
    "tests/operations-drilldown.test.tsx",
    "tests/security-boundary.test.ts",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/root-fullstack-acceptance.mjs",
    "scripts/production-mode-rc.mjs",
    "scripts/admin-feed-recheck-action-verify.mjs",
    ".docs/admin-operations-dashboard.md",
    ".docs/api-auth-contract.md",
    ".docs/admin-auth-session-boundary.md",
    ".docs/production-activation-package.md",
    "README.md",
    "PRODUCTION.md",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/src/admin-api/admin-feed-recheck-action-ref.ts",
    "../rss-habersoft-com/src/admin-api/admin-feed-recheck.service.ts",
    "../rss-habersoft-com/src/admin-api/admin-feed-recheck.types.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.controller.ts",
    "../rss-habersoft-com/src/admin-auth/admin-auth.service.ts",
    "../rss-habersoft-com/src/bootstrap/api-entrypoint.ts",
    "../rss-habersoft-com/test/admin-api/admin-feed-recheck.controller.spec.ts",
    "../rss-habersoft-com/.docs/admin-operations-drilldown-api.md"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "verify:admin-feed-recheck-action": "node scripts/admin-feed-recheck-action-verify.mjs",
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "test:fullstack": "node scripts/root-fullstack-acceptance.mjs",
    "test:production-mode-rc": "node scripts/production-mode-rc.mjs",
    "verify:production-readiness": "node scripts/production-readiness-verify.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertFrontendContract() {
  const client = readFrontend("src/adminOperations/feedRecheckClient.ts");
  const drilldownClient = readFrontend("src/adminOperations/operationsDrilldownClient.ts");
  const component = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  const sessionClient = readFrontend("src/auth/adminSessionClient.ts");
  const boundary = readFrontend("src/auth/adminSessionBoundary.ts");
  const tests = [
    readFrontend("tests/feed-recheck-client.test.ts"),
    readFrontend("tests/operations-drilldown-client.test.ts"),
    readFrontend("tests/operations-drilldown.test.tsx"),
    readFrontend("tests/security-boundary.test.ts"),
    readFrontend("tests/admin-session-client.test.ts")
  ].join("\n");

  for (const fragment of [
    `ADMIN_FEED_RECHECK_PATH = "${route}"`,
    'method: "POST"',
    'credentials: "same-origin"',
    'cache: "no-store"',
    'redirect: "manual"',
    'Accept: "application/json"',
    '"Content-Type": "application/json"',
    '"X-Admin-CSRF"',
    '"X-Admin-Idempotency-Key"',
    'reason: "operator_request"',
    "browserPersistence: false",
    "synchronousExternalFetch: false",
    "arbitraryWrites: false",
    "parseFeedRecheckResponse",
    "isSafeMessage"
  ]) {
    if (!client.includes(fragment)) failures.push(`feed recheck client missing ${fragment}`);
  }

  for (const forbidden of [/Authorization\s*:/iu, /Cookie\s*:/iu, /X-Agent-Key/iu, /Tenant/iu, /https?:\/\//iu]) {
    if (forbidden.test(client)) failures.push(`feed recheck client contains forbidden browser surface: ${forbidden}`);
  }

  for (const fragment of [
    "canRequestRecheck",
    "recheckUnavailableReason",
    "actionRef",
    "feedRecheckActionMetadata: true",
    "writeMethods: false"
  ]) {
    if (!drilldownClient.includes(fragment)) failures.push(`drilldown client missing action metadata ${fragment}`);
  }

  for (const fragment of [
    "Request recheck",
    "Request a safe recheck for this feed?",
    "Confirm",
    "Cancel",
    "requestFeedRecheck",
    "csrfToken",
    "accepted",
    "already_pending",
    "rate_limited",
    "forbidden",
    "unauthenticated"
  ]) {
    if (!component.includes(fragment)) failures.push(`OperationsDrilldown missing ${fragment}`);
  }

  for (const fragment of [
    "csrfToken",
    "parseAuthenticatedBody",
    "currentAuthenticatedStateImplemented: true",
    "browserPersistence: false"
  ]) {
    if (!sessionClient.includes(fragment)) failures.push(`admin session client missing CSRF contract ${fragment}`);
  }

  for (const fragment of [
    `sameOriginAdminFeedRecheckPath: "${route}"`,
    'adminApiWritesImplemented: "bounded_feed_recheck_request_only"'
  ]) {
    if (!boundary.includes(fragment)) failures.push(`admin session boundary missing ${fragment}`);
  }

  for (const fragment of [
    route,
    "X-Admin-CSRF",
    "X-Admin-Idempotency-Key",
    "explicit confirmation",
    "csrf_failed",
    "accepted",
    "already_pending",
    "rate_limited",
    "operationsDrilldownClientContract.browserPersistence"
  ]) {
    if (!tests.includes(fragment)) failures.push(`frontend tests missing ${fragment}`);
  }
}

function assertBackendContract() {
  const actionRef = readBackend("src/admin-api/admin-feed-recheck-action-ref.ts");
  const service = readBackend("src/admin-api/admin-feed-recheck.service.ts");
  const types = readBackend("src/admin-api/admin-feed-recheck.types.ts");
  const controller = readBackend("src/admin-api/admin-operations-summary.controller.ts");
  const auth = readBackend("src/admin-auth/admin-auth.service.ts");
  const bootstrap = readBackend("src/bootstrap/api-entrypoint.ts");
  const tests = readBackend("test/admin-api/admin-feed-recheck.controller.spec.ts");

  for (const fragment of [
    "aes-256-gcm",
    "feed_recheck_v1",
    "createFeedRecheckActionRef",
    "parseFeedRecheckActionRef",
    "feedId",
    "actionRefPattern"
  ]) {
    if (!actionRef.includes(fragment)) failures.push(`action ref helper missing ${fragment}`);
  }

  for (const fragment of [
    "ADMIN_FEED_RECHECK_BODY_LIMIT_BYTES = 2048",
    "requestFeedRecheck",
    "parseFeedRecheckActionRef",
    "idempotencyKeyPattern",
    "cooldownSeconds = 300",
    "this.redis.command().call(\"GET\"",
    "this.redis.command().call(\"TTL\"",
    "this.redis.command().call(\"SET\"",
    "feed.updateMany",
    "nextCheckAt: now",
    "active: true",
    "subscriberCount: { gt: 0 }",
    "safeSourceHost",
    "displayId",
    "operator_request"
  ]) {
    if (!service.includes(fragment)) failures.push(`feed recheck service missing ${fragment}`);
  }
  if (/\bfetch\s*\(/iu.test(service) || /http:\/\/|https:\/\//iu.test(service)) {
    failures.push("feed recheck service appears to perform or embed an HTTP fetch/URL");
  }

  for (const fragment of ["accepted", "already_pending", "unavailable", "not_found", "rate_limited", "cooldownSeconds"]) {
    if (!types.includes(fragment)) failures.push(`feed recheck types missing ${fragment}`);
  }

  for (const fragment of [
    '@Post("feed-recheck-requests")',
    "@Body() body: unknown",
    "authenticatedSession(request)",
    "isJsonRequest(request)",
    "hasQueryString(request)",
    'request.headers["x-admin-csrf"]',
    "isValidCsrfToken",
    'request.headers["x-admin-idempotency-key"]',
    "reply.status(result.httpStatus)",
    "feed_recheck_requires_post"
  ]) {
    if (!controller.includes(fragment)) failures.push(`admin operations controller missing action fragment ${fragment}`);
  }

  for (const fragment of [
    "csrfToken",
    "isValidCsrfToken",
    "constantTimeStringEquals",
    "authenticatedSession",
    "sessionKey"
  ]) {
    if (!auth.includes(fragment)) failures.push(`admin auth service missing CSRF/session fragment ${fragment}`);
  }

  if (!bootstrap.includes("ADMIN_FEED_RECHECK_BODY_LIMIT_BYTES")) failures.push("api entrypoint missing feed recheck body limit");

  for (const fragment of [
    route,
    "fails closed without admin auth configured",
    "requires an authenticated admin session",
    "rejects malformed bodies, missing CSRF, invalid CSRF, and missing idempotency",
    "returns not_found for an unknown opaque target",
    "schedules one eligible feed by moving nextCheckAt to now and dedupes retries",
    "rate limits a second accepted request",
    "not.toContain(\"https://news.example.org/feed.xml\")"
  ]) {
    if (!tests.includes(fragment)) failures.push(`backend feed recheck tests missing ${fragment}`);
  }
}

function assertProxyContract() {
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const harness = readFrontend("scripts/admin-api-proxy-template-harness.mjs");
  const runtime = `${entrypoint}\n${harness}`;

  for (const fragment of [
    `location = ${route}`,
    "client_max_body_size 2k",
    "if (\\$request_method != POST)",
    "set \\$args \"\";",
    "proxy_pass_request_headers off;",
    'proxy_set_header Content-Type "application/json";',
    "proxy_set_header Cookie \\$http_cookie;",
    "proxy_set_header X-Admin-CSRF \\$http_x_admin_csrf;",
    "proxy_set_header X-Admin-Idempotency-Key \\$http_x_admin_idempotency_key;",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "proxy_hide_header Access-Control-Allow-Origin;",
    "error_page 403 = @admin_api_forbidden;",
    `proxy_pass \\$admin_api_upstream_origin${route}?;`,
    "generated Nginx config is missing /admin-api/operations/feed-recheck-requests"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`feed recheck proxy contract missing ${fragment}`);
  }

  for (const fragment of [
    "rss-admin-ui:ms026b-local",
    route,
    "nginx -T",
    "authenticated admin-api feed recheck",
    "missing CSRF admin-api feed recheck",
    "admin-api feed recheck query stripping",
    "proxy_set_header X-Admin-CSRF",
    "proxy_set_header X-Admin-Idempotency-Key",
    "admin-api feed recheck route appears after SPA fallback",
    "static no-auth-upstream admin-api feed recheck",
    "unreachable admin-api upstream feed recheck"
  ]) {
    if (!harness.includes(fragment)) failures.push(`admin-api proxy template harness missing ${fragment}`);
  }

  if (!runtime.includes("authorization header reached admin-api upstream")) {
    failures.push("proxy harness does not prove Authorization stripping");
  }
  if (!runtime.includes("agent key header reached admin-api upstream")) {
    failures.push("proxy harness does not prove Agent key stripping");
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
    drilldownStatus,
    route,
    "POST /admin-api/operations/feed-recheck-requests",
    "bounded feed recheck",
    "X-Admin-CSRF",
    "X-Admin-Idempotency-Key",
    "idempotency",
    "cooldown",
    "explicit confirmation",
    "existing due-feed path",
    "no synchronous external feed fetch",
    "operator deploy/retest required",
    "Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys",
    "Codex did not independently perform a credentialed production login",
    "No production deployment was performed by Codex for MS-026A",
    "npm run verify:admin-feed-recheck-action",
    "npm run test:admin-api-proxy-template",
    "npm run test:fullstack",
    "npm run test:production-mode-rc"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-026A fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bMS-026A\b[^\n]{0,160}\bproduction\s+acceptance\s+(?:accepted|closed|passed|complete)\b/iu,
    /\bfeed recheck action production acceptance\s+(?:accepted|closed|passed|complete)\b/iu,
    /\bCodex (?:deployed|restarted|recreated|mutated)\s+production\b/iu,
    /\bCodex (?:logged in|performed a credentialed production login|used real admin credentials)\b/iu,
    /\barbitrary admin writes\s+(?:are|were)\s+accepted\b/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden MS-026A claim: ${forbidden}`);
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
    { label: "synthetic CSRF/idempotency value", pattern: /csrf_token_value_at_least_32_characters|idem_1234567890abcdef|idem_abcdef1234567890/u },
    { label: "raw feed URL", pattern: /https:\/\/news\.example\.org\/feed\.xml/iu },
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
