import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const requiredFiles = [
  "src/auth/adminSessionBoundary.ts",
  "src/auth/adminSessionClient.ts",
  "src/auth/ProtectedAdminShell.tsx",
  "src/auth/useAdminSessionStatus.ts",
  "tests/admin-session-boundary.test.ts",
  "tests/admin-session-client.test.ts",
  "tests/protected-admin-shell.test.tsx",
  "scripts/auth-session-sentinel-harness.mjs",
  "scripts/auth-proxy-harness.mjs",
  ".docs/admin-auth-session-boundary.md",
  ".docs/admin-session-sentinel.md"
];

for (const file of requiredFiles) requireFile(file);
assertPackageScripts();
assertBoundarySource();
assertSessionClientSource();
assertProtectedShellSource();
assertRuntimeAuthRoutes();
assertHealthClientSafety();
assertDocsContract();
assertNoForbiddenBrowserStrings();

if (failures.length > 0) {
  for (const failure of failures) console.error(`auth-boundary-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "auth-boundary-verify-ok",
      real_auth: "local_foundation_enabled_by_server_config",
      default_runtime: "static_fail_closed",
      same_origin_admin_auth: "exact_routes_only",
      protected_shell: "authenticated_session_required",
      public_health_surface: "credential_free",
      browser_persistence: "absent",
      deployed: false
    },
    null,
    2
  )
);

function assertPackageScripts() {
  const packageJson = JSON.parse(readText("package.json"));
  const scripts = packageJson.scripts ?? {};
  const required = {
    "verify:auth-boundary": "node scripts/auth-boundary-verify.mjs",
    "test:auth-session-sentinel": "node scripts/auth-session-sentinel-harness.mjs",
    "test:auth-proxy": "node scripts/auth-proxy-harness.mjs",
    "test:fullstack": "node scripts/root-fullstack-acceptance.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name} script`);
  }
}

function assertBoundarySource() {
  const source = readText("src/auth/adminSessionBoundary.ts");
  const required = [
    "defaultAdminAuthBoundaryState",
    'kind: "same_origin_session"',
    'sameOriginAdminSessionPath: "/admin-auth/session"',
    'sameOriginAdminLoginPath: "/admin-auth/login"',
    'sameOriginAdminLogoutPath: "/admin-auth/logout"',
    'sameOriginAdminOperationsSummaryPath: "/admin-api/operations/summary"',
    'sameOriginAdminOperationsDrilldownPath: "/admin-api/operations/drilldown"',
    'sameOriginAdminFeedOnboardingPath: "/admin-api/operations/feed-onboarding-requests"',
    "sameOriginAdminSessionSentinelOnly: false",
    "realAuthImplemented: true",
    "defaultAllowsProtectedContent: false",
    "browserCredentialExchangeImplemented: true",
    "browserCredentialPersistenceImplemented: false",
    "fakeAdminIdentityAllowed: false",
    "privilegedBusinessDataAllowed: false",
    'adminApiWritesImplemented: "bounded_feed_recheck_and_feed_onboarding_requests_only"',
    "sameOriginAdminFeedRecheckPath",
    "canRenderProtectedAdminContent",
    'sessionStatus?.kind === "authenticated"'
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`adminSessionBoundary missing ${fragment}`);
  }
}

function assertSessionClientSource() {
  const source = readText("src/auth/adminSessionClient.ts");
  const required = [
    'ADMIN_SESSION_STATUS_PATH = "/admin-auth/session"',
    'ADMIN_SESSION_LOGIN_PATH = "/admin-auth/login"',
    'ADMIN_SESSION_LOGOUT_PATH = "/admin-auth/logout"',
    "ADMIN_SESSION_SENTINEL_HTTP_STATUS = 501",
    '"not_configured"',
    '"unauthenticated"',
    '"authenticated"',
    'credentials: "same-origin"',
    'cache: "no-store"',
    'redirect: "manual"',
    "AbortController",
    "currentAuthenticatedStateImplemented: true",
    "browserPersistence: false",
    "customCredentialHeaders: false",
    "principalLikeKeys"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`adminSessionClient missing ${fragment}`);
  }
  if (/https?:\/\//iu.test(source)) {
    failures.push("adminSessionClient must not use an absolute URL");
  }
  if (/credentials:\s*["']include["']/iu.test(source)) {
    failures.push("adminSessionClient must not send cross-origin credentials");
  }
  if (/Authorization\s*:|Cookie\s*:|X-Agent-Key|AGENT_KEY|ADMIN_UI_API_BASE_URL|ADMIN_UI_HEALTH_UPSTREAM_ORIGIN|ADMIN_UI_AUTH_UPSTREAM_ORIGIN/iu.test(source)) {
    failures.push("adminSessionClient contains forbidden auth or runtime env names");
  }
  if (/\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u.test(source)) {
    failures.push("adminSessionClient contains browser persistence");
  }
}

function assertProtectedShellSource() {
  const source = readText("src/auth/ProtectedAdminShell.tsx");
  const required = [
    "Admin sign-in required",
    "Admin session active",
    "sessionStatus.kind",
    "No Tenant bearer, Agent key, or business write credential",
    "canRenderProtectedAdminContent",
    "protected-admin-slot",
    "onLogin",
    "onLogout"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`ProtectedAdminShell missing ${fragment}`);
  }
  if (/admin@example|tenant id|feed count|saved entries|admin metrics/iu.test(source)) {
    failures.push("ProtectedAdminShell contains fake privileged-looking data");
  }
}

function assertRuntimeAuthRoutes() {
  const nginx = readText("nginx.conf");
  if (!nginx.includes("__ADMIN_UI_AUTH_ROUTES__")) failures.push("nginx template missing auth routes placeholder");

  const entrypoint = readText("docker-entrypoint.sh");
  const required = [
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "auth_static_routes",
    "auth_proxy_routes",
    "location = /admin-auth/session",
    "location = /admin-auth/login",
    "location = /admin-auth/logout",
    "proxy_pass_request_headers off",
    "proxy_set_header Cookie \\$http_cookie",
    "set \\$admin_auth_upstream_origin",
    "proxy_pass \\$admin_auth_upstream_origin/admin-auth/session?",
    "proxy_pass \\$admin_auth_upstream_origin/admin-auth/login?",
    "proxy_pass \\$admin_auth_upstream_origin/admin-auth/logout?",
    "location ^~ /admin-auth/",
    "return 404",
    "return 405",
    "client_max_body_size 4k",
    "reason\":\"auth_unavailable"
  ];
  for (const fragment of required) {
    if (!entrypoint.includes(fragment)) failures.push(`docker-entrypoint auth route missing ${fragment}`);
  }
  if (!entrypoint.includes('return 501 \'{"configured":false,"status":"not_configured"')) {
    failures.push("static auth session sentinel missing");
  }

  const sentinelHarness = readText("scripts/auth-session-sentinel-harness.mjs");
  const proxyHarness = readText("scripts/auth-proxy-harness.mjs");
  for (const fragment of [
    '"/admin-auth/session"',
    '"/admin-auth/login"',
    '"/admin-auth/logout"',
    '"/admin-auth/unknown"',
    "records.length === 0",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"
  ]) {
    if (!sentinelHarness.includes(fragment) && !proxyHarness.includes(fragment)) {
      failures.push(`auth runtime harnesses missing ${fragment}`);
    }
  }
}

function assertHealthClientSafety() {
  const source = readText("src/status/healthClient.ts");
  const required = [
    'credentials: "omit"',
    'cache: "no-store"',
    'method: "GET"',
    'Accept: "application/json"',
    '"/status-api/health/live"',
    '"/status-api/health/ready"',
    "authorizationHeader: false",
    "agentKeyHeader: false",
    "writes: false"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`healthClient missing ${fragment}`);
  }
  if (/credentials:\s*["'](?:include|same-origin)["']/iu.test(source)) {
    failures.push("healthClient sends browser credentials");
  }
  if (/Authorization\s*:|X-Agent-Key|token\s*=|access_token|bearer\s+[a-z0-9._-]/iu.test(source)) {
    failures.push("healthClient contains auth credential material");
  }
}

function assertDocsContract() {
  const docs = [
    readText(".docs/admin-auth-session-boundary.md"),
    readText(".docs/admin-session-sentinel.md"),
    readText(".docs/api-auth-contract.md"),
    readText("README.md"),
    readText("PRODUCTION.md")
  ].join("\n");
  const required = [
    "MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY",
    "NOT_DEPLOYED",
    "ADMIN_UI_AUTH_MODE=disabled",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN",
    "/admin-auth/session",
    "/admin-auth/login",
    "/admin-auth/logout",
    "HttpOnly",
    "SameSite=Lax",
    "server-side",
    "Agent key",
    "Tenant bearer",
    "/admin-api/operations/summary",
    "/admin-api/operations/drilldown",
    "no production deployment",
    "MS-021B",
    "static fail-closed"
  ];
  for (const fragment of required) {
    if (!docs.includes(fragment)) failures.push(`auth boundary docs missing ${fragment}`);
  }
}

function assertNoForbiddenBrowserStrings() {
  const files = [
    ...collectFiles(path.join(root, "src")),
    ...collectFiles(path.join(root, "public")),
    path.join(root, "index.html"),
    ...collectFiles(path.join(root, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());

  const forbidden = [
    { label: "agent key env", pattern: /AGENT_KEY\s*=/u },
    { label: "agent key header", pattern: /X-Agent-Key/iu },
    { label: "database url", pattern: /DATABASE_URL/u },
    { label: "private key", pattern: /PRIVATE KEY|BEGIN RSA PRIVATE KEY|BEGIN PRIVATE KEY/u },
    { label: "production env file", pattern: /\.env\.production/u },
    { label: "hardcoded bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "legacy api base", pattern: /ADMIN_UI_API_BASE_URL/u },
    { label: "server upstream origin", pattern: /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u },
    { label: "local compose upstream", pattern: /main-service-api:3000/u }
  ];

  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const check of forbidden) {
      if (check.pattern.test(text)) {
        failures.push(`${check.label} in browser source/build: ${path.relative(root, file)}`);
        break;
      }
    }
  }
}

function requireFile(relative) {
  const file = path.join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) failures.push(`missing required file: ${relative}`);
}

function readText(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}
