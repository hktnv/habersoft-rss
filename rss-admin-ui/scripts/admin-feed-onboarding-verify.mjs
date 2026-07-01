import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const route = "/admin-api/operations/feed-onboarding-requests";
const recheckRoute = "/admin-api/operations/feed-recheck-requests";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertFrontendContract();
assertBackendContract();
assertProxyContract();
assertOperatorContract();
assertDocsContract();
assertBrowserSafety();

if (failures.length > 0) {
  for (const failure of failures) console.error(`admin-feed-onboarding-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "admin-feed-onboarding-verify-ok",
      milestone: status,
      routes: [route, recheckRoute],
      same_origin: true,
      authenticated_admin_only: true,
      csrf_required: true,
      idempotency_required: true,
      no_synchronous_external_fetch: true,
      raw_feed_url_in_response_or_evidence: false,
      production_contact: false,
      production_acceptance_claimed: false
    },
    null,
    2
  )
);

function assertRequiredFiles() {
  for (const file of [
    "src/adminOperations/feedOnboardingClient.ts",
    "src/adminOperations/FeedOnboardingPanel.tsx",
    "src/adminOperations/OperationsDrilldown.tsx",
    "src/adminOperations/browserEvidence.ts",
    "src/auth/adminSessionBoundary.ts",
    "tests/feed-onboarding-client.test.ts",
    "tests/operations-drilldown.test.tsx",
    "tests/browser-evidence.test.ts",
    "tests/security-boundary.test.ts",
    "scripts/admin-feed-onboarding-verify.mjs",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/operator-production-retest.mjs",
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/operator-risk-model.mjs",
    "scripts/browser-evidence-verify.mjs",
    ".docs/admin-operations-dashboard.md",
    ".docs/api-auth-contract.md",
    ".docs/admin-auth-session-boundary.md",
    ".docs/production-activation-package.md",
    ".docs/operator-risk-model.md",
    "README.md",
    "PRODUCTION.md",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/src/admin-api/admin-feed-onboarding.service.ts",
    "../rss-habersoft-com/src/admin-api/admin-feed-onboarding.types.ts",
    "../rss-habersoft-com/src/admin-api/admin-operations-summary.controller.ts",
    "../rss-habersoft-com/src/bootstrap/api-entrypoint.ts",
    "../rss-habersoft-com/src/tenant-feeds/reserved-site-client-ids.ts",
    "../rss-habersoft-com/src/tenant-auth/tenant-jwt.verifier.ts",
    "../rss-habersoft-com/test/admin-api/admin-feed-onboarding.controller.spec.ts",
    "../rss-habersoft-com/test/tenant-auth/tenant-jwt.verifier.spec.ts",
    "../rss-habersoft-com/.docs/admin-operations-drilldown-api.md"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "verify:admin-feed-onboarding": "node scripts/admin-feed-onboarding-verify.mjs",
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
  const client = readFrontend("src/adminOperations/feedOnboardingClient.ts");
  const panel = readFrontend("src/adminOperations/FeedOnboardingPanel.tsx");
  const drilldown = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  const evidence = readFrontend("src/adminOperations/browserEvidence.ts");
  const evidenceVerifier = readFrontend("scripts/browser-evidence-verify.mjs");
  const boundary = readFrontend("src/auth/adminSessionBoundary.ts");
  const tests = [
    readFrontend("tests/feed-onboarding-client.test.ts"),
    readFrontend("tests/operations-drilldown.test.tsx"),
    readFrontend("tests/browser-evidence.test.ts"),
    readFrontend("tests/security-boundary.test.ts")
  ].join("\n");

  for (const fragment of [
    `ADMIN_FEED_ONBOARDING_PATH = "${route}"`,
    'method: "POST"',
    'credentials: "same-origin"',
    'cache: "no-store"',
    'redirect: "manual"',
    'Accept: "application/json"',
    '"Content-Type": "application/json"',
    '"X-Admin-CSRF"',
    '"X-Admin-Idempotency-Key"',
    "browserPersistence: false",
    "synchronousExternalFetch: false",
    "arbitraryWrites: false",
    "rawUrlInEvidence: false",
    "parseFeedOnboardingResponse",
    "safeSourceHost",
    "isSafeMessage"
  ]) {
    if (!client.includes(fragment)) failures.push(`feed onboarding client missing ${fragment}`);
  }

  for (const forbidden of [/Authorization\s*:/iu, /Cookie\s*:/iu, /X-Agent-Key/iu, /\bTenant\b/iu]) {
    if (forbidden.test(client)) failures.push(`feed onboarding client contains forbidden browser credential surface: ${forbidden}`);
  }

  for (const fragment of [
    "Feed Onboarding",
    "Confirm the real feed onboarding action before submitting.",
    "This creates a real feed target after operator deployment.",
    "Onboard feed",
    "displayId",
    "sourceHost",
    "eligibleForRecheck"
  ]) {
    if (!panel.includes(fragment)) failures.push(`FeedOnboardingPanel missing ${fragment}`);
  }

  for (const fragment of [
    "FeedOnboardingPanel",
    "requestOnboarding",
    "onFeedOnboardingAccepted",
    "refreshAfterFeedOnboarding"
  ]) {
    if (!drilldown.includes(fragment)) failures.push(`OperationsDrilldown missing onboarding fragment ${fragment}`);
  }

  for (const fragment of [
    "feedOnboarding",
    "feed_onboarding_available",
    "feed_onboarding_status",
    "no_eligible_target",
    "critical_risk",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE"
  ]) {
    if (!evidence.includes(fragment) || !evidenceVerifier.includes(fragment)) {
      failures.push(`browser evidence contract missing ${fragment}`);
    }
  }

  for (const fragment of [
    `sameOriginAdminFeedOnboardingPath: "${route}"`,
    'adminApiWritesImplemented: "bounded_feed_recheck_and_feed_onboarding_requests_only"'
  ]) {
    if (!boundary.includes(fragment)) failures.push(`admin session boundary missing ${fragment}`);
  }

  for (const fragment of [
    route,
    "explicit confirmation",
    "X-Admin-CSRF",
    "X-Admin-Idempotency-Key",
    "created",
    "already_exists",
    "rate_limited",
    "sourceHost",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "same-origin"
  ]) {
    if (!tests.includes(fragment)) failures.push(`frontend tests missing ${fragment}`);
  }
}

function assertBackendContract() {
  const service = readBackend("src/admin-api/admin-feed-onboarding.service.ts");
  const types = readBackend("src/admin-api/admin-feed-onboarding.types.ts");
  const controller = readBackend("src/admin-api/admin-operations-summary.controller.ts");
  const bootstrap = readBackend("src/bootstrap/api-entrypoint.ts");
  const reserved = readBackend("src/tenant-feeds/reserved-site-client-ids.ts");
  const jwtVerifier = readBackend("src/tenant-auth/tenant-jwt.verifier.ts");
  const tests = [
    readBackend("test/admin-api/admin-feed-onboarding.controller.spec.ts"),
    readBackend("test/tenant-auth/tenant-jwt.verifier.spec.ts")
  ].join("\n");

  for (const fragment of [
    "ADMIN_FEED_ONBOARDING_BODY_LIMIT_BYTES = 4096",
    "requestFeedOnboarding",
    "idempotencyKeyPattern",
    "cooldownSeconds = 300",
    "this.redis.command().call(\"GET\"",
    "this.redis.command().call(\"TTL\"",
    "this.redis.command().call(\"SET\"",
    "parseFeedUrl",
    "safeSourceHost",
    "parseLabel",
    "ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID",
    "siteFeed.create",
    "subscriberCount: { increment: 1 }",
    "nextCheckAt",
    "displayId",
    "sourceHost",
    "eligibleForRecheck"
  ]) {
    if (!service.includes(fragment)) failures.push(`feed onboarding service missing ${fragment}`);
  }
  if (/\bfetch\s*\(/iu.test(service)) failures.push("feed onboarding service appears to perform HTTP fetch");

  for (const fragment of ["created", "already_exists", "unavailable", "rate_limited", "requestRef", "eligibleForRecheck"]) {
    if (!types.includes(fragment)) failures.push(`feed onboarding types missing ${fragment}`);
  }

  for (const fragment of [
    '@Post("feed-onboarding-requests")',
    "@Body() body: unknown",
    "authenticatedSession(request)",
    "isJsonRequest(request)",
    "hasQueryString(request)",
    'request.headers["x-admin-csrf"]',
    "isValidCsrfToken",
    'request.headers["x-admin-idempotency-key"]',
    "reply.status(result.httpStatus)",
    "feed_onboarding_requires_post"
  ]) {
    if (!controller.includes(fragment)) failures.push(`controller missing onboarding fragment ${fragment}`);
  }

  if (!bootstrap.includes("ADMIN_FEED_ONBOARDING_BODY_LIMIT_BYTES")) failures.push("api entrypoint missing feed onboarding body limit");
  if (!reserved.includes("__habersoft_admin_feed_onboarding__") || !reserved.includes("isReservedSiteClientId")) {
    failures.push("reserved admin onboarding site client id guard is missing");
  }
  if (!jwtVerifier.includes("isReservedSiteClientId")) failures.push("tenant JWT verifier does not reject reserved admin site client ids");

  for (const fragment of [
    route,
    "fails closed without admin auth configured",
    "requires an authenticated admin session before validation or writes",
    "rejects malformed bodies, missing CSRF, invalid CSRF, missing idempotency, and query strings",
    "rejects unsafe feed URL targets without touching feed state",
    "creates one reserved admin onboarding relation and makes the feed eligible without exposing the raw URL",
    "dedupes idempotent retries and rate limits a second accepted request for the same host",
    "returns already_exists for an existing admin-onboarded feed without broad writes",
    "does not activate an existing disabled feed",
    "ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID"
  ]) {
    if (!tests.includes(fragment)) failures.push(`backend onboarding tests missing ${fragment}`);
  }
}

function assertProxyContract() {
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const harness = readFrontend("scripts/admin-api-proxy-template-harness.mjs");

  for (const fragment of [
    `location = ${route}`,
    "client_max_body_size 4k",
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
    `proxy_pass \\$admin_api_upstream_origin${route}?;`,
    "generated Nginx config is missing /admin-api/operations/feed-onboarding-requests"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`feed onboarding proxy contract missing ${fragment}`);
  }

  for (const fragment of [
    route,
    "authenticated admin-api feed onboarding",
    "missing CSRF admin-api feed onboarding",
    "admin-api feed onboarding query stripping",
    "GET admin-api feed onboarding",
    "static no-auth-upstream admin-api feed onboarding",
    "unreachable admin-api upstream feed onboarding",
    "proxy_set_header X-Admin-CSRF",
    "proxy_set_header X-Admin-Idempotency-Key"
  ]) {
    if (!harness.includes(fragment)) failures.push(`admin-api proxy template harness missing onboarding fragment ${fragment}`);
  }
}

function assertOperatorContract() {
  const retest = readFrontend("scripts/operator-production-retest.mjs");
  const promotion = readFrontend("scripts/operator-production-promotion-retest.mjs");
  const risk = readFrontend("scripts/operator-risk-model.mjs");
  const composeOps = readFrontend("scripts/production-compose-ops.mjs");
  const automationVerify = readFrontend("scripts/operator-automation-verify.mjs");

  for (const fragment of [
    route,
    "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
    "FEED_ONBOARDING_ROUTE_SMOKE_ATTENTION_REQUIRED",
    "feed_onboarding_status",
    "manual_operator_action_required",
    "FEED_ONBOARDING_UNAUTH_POST_NOT_401_JSON",
    "FEED_ONBOARDING_GET_NOT_405_JSON"
  ]) {
    if (!retest.includes(fragment)) failures.push(`operator retest missing onboarding fragment ${fragment}`);
  }

  for (const fragment of [
    route,
    "feed_onboarding_classification",
    "feed_onboarding_status",
    "ADMIN_FEED_ONBOARDING_ROUTE_UNSAFE",
    "required_routes"
  ]) {
    if (!promotion.includes(fragment)) failures.push(`promotion retest missing onboarding fragment ${fragment}`);
  }

  if (!risk.includes("MS-027A_RISK_BALANCED_GUARDRAILS") && !risk.includes("MS-027B_RISK_BALANCED_GUARDRAILS")) {
    failures.push("risk model missing MS-027A/MS-027B onboarding guardrail version");
  }

  for (const fragment of [
    "ADMIN_FEED_ONBOARDING_ROUTE_UNSAFE",
    "FEED_ONBOARDING_RAW_URL_EVIDENCE",
    "FEED_ONBOARDING_OPERATOR_ACTION_REQUIRED"
  ]) {
    if (!risk.includes(fragment)) failures.push(`risk model missing onboarding fragment ${fragment}`);
  }

  if (!composeOps.includes(route)) failures.push("production compose diagnostics missing onboarding route proof");
  if (!automationVerify.includes(route) || !automationVerify.includes("FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED")) {
    failures.push("operator automation verifier missing feed onboarding runtime coverage");
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
    readFrontend(".docs/operator-risk-model.md"),
    readFrontend(".docs/operator-automation-acceptance.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-operations-drilldown-api.md")
  ].join("\n");

  for (const fragment of [
    status,
    route,
    "POST /admin-api/operations/feed-onboarding-requests",
    "authenticated admin feed onboarding",
    "X-Admin-CSRF",
    "X-Admin-Idempotency-Key",
    "idempotency",
    "reserved admin onboarding relation",
    "no synchronous external feed fetch",
    "no raw feed URL in response or evidence",
    "operator deploy/retest required",
    "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "npm run verify:admin-feed-onboarding",
    "npm run test:admin-api-proxy-template",
    "npm run test:fullstack",
    "npm run test:production-mode-rc",
    "Codex did not perform production contact",
    "No production feed was created, seeded, or faked"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-027A fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bMS-027A\b[^\n]{0,180}\bproduction\s+acceptance\s+(?:accepted|closed|passed|complete)\b/iu,
    /\bfeed onboarding production acceptance\s+(?:accepted|closed|passed|complete)\b/iu,
    /\bCodex (?:deployed|restarted|recreated|mutated)\s+production\b/iu,
    /\bCodex (?:logged in|performed a credentialed production login|used real admin credentials)\b/iu,
    /\braw feed URL\b[^\n]{0,120}\b(?:may|can|should)\s+be\s+(?:included|pasted|stored)\b/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden MS-027A claim: ${forbidden}`);
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
    { label: "agent key header/env", pattern: /X-Agent-Key|AGENT_KEY\s*=/iu },
    { label: "tenant bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "synthetic CSRF/idempotency value", pattern: /csrf_token_value_at_least_32_characters|idem_1234567890abcdef|idem_abcdef1234567890/u },
    { label: "raw test feed URL", pattern: /https:\/\/(?:news|onboarding)\.example\.org\/feed\.xml/iu },
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
