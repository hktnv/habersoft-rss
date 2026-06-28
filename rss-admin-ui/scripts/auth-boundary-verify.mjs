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
  ".docs/admin-auth-session-boundary.md",
  ".docs/admin-session-sentinel.md"
];

for (const file of requiredFiles) requireFile(file);
assertPackageScript();
assertBoundarySource();
assertSessionClientSource();
assertProtectedShellSource();
assertHealthClientSafety();
assertRuntimeSentinelSafety();
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
      real_auth: "not_implemented",
      same_origin_admin_session: "sentinel_only",
      protected_shell: "blocked_by_default",
      public_health_surface: "credential_free",
      browser_persistence: "absent"
    },
    null,
    2
  )
);

function assertPackageScript() {
  const packageJson = JSON.parse(readText("package.json"));
  if (packageJson.scripts?.["verify:auth-boundary"] !== "node scripts/auth-boundary-verify.mjs") {
    failures.push("package.json missing verify:auth-boundary script");
  }
  if (packageJson.scripts?.["test:auth-session-sentinel"] !== "node scripts/auth-session-sentinel-harness.mjs") {
    failures.push("package.json missing test:auth-session-sentinel script");
  }
}

function assertBoundarySource() {
  const source = readText("src/auth/adminSessionBoundary.ts");
  const required = [
    "defaultAdminAuthBoundaryState",
    'kind: "not_configured"',
    'sameOriginAdminSessionSentinelPath: "/admin-auth/session"',
    "sameOriginAdminSessionSentinelOnly: true",
    "realAuthImplemented: false",
    "defaultAllowsProtectedContent: false",
    "browserCredentialExchangeImplemented: false",
    "browserCredentialPersistenceImplemented: false",
    "fakeAdminIdentityAllowed: false",
    "privilegedBusinessDataAllowed: false",
    "adminApiWritesImplemented: false",
    "futureAuthorityRequired: true",
    "canRenderProtectedAdminContent",
    "return false"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`adminSessionBoundary missing ${fragment}`);
  }
  if (source.includes('"authenticated"') || source.includes("'authenticated'")) {
    failures.push("adminSessionBoundary must not define a current authenticated state");
  }
}

function assertSessionClientSource() {
  const source = readText("src/auth/adminSessionClient.ts");
  const required = [
    'ADMIN_SESSION_STATUS_PATH = "/admin-auth/session"',
    "ADMIN_SESSION_SENTINEL_HTTP_STATUS = 501",
    '"unknown"',
    '"checking"',
    '"not_configured"',
    '"auth_unavailable"',
    '"invalid_response"',
    '"timeout"',
    'credentials: "omit"',
    'cache: "no-store"',
    'redirect: "manual"',
    "AbortController",
    "response.status !== ADMIN_SESSION_SENTINEL_HTTP_STATUS",
    "value.authenticated !== false",
    "currentAuthenticatedStateImplemented: false",
    "customCredentialHeaders: false"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`adminSessionClient missing ${fragment}`);
  }
  if (/https?:\/\//iu.test(source)) {
    failures.push("adminSessionClient must not use an absolute URL");
  }
  if (/credentials:\s*["'](?:include|same-origin)["']/iu.test(source)) {
    failures.push("adminSessionClient sends browser credentials");
  }
  if (/Authorization\s*:|X-Agent-Key|AGENT_KEY|ADMIN_UI_API_BASE_URL|ADMIN_UI_HEALTH_UPSTREAM_ORIGIN/iu.test(source)) {
    failures.push("adminSessionClient contains forbidden auth or runtime env names");
  }
}

function assertProtectedShellSource() {
  const source = readText("src/auth/ProtectedAdminShell.tsx");
  const required = [
    "Admin authentication is not configured yet",
    "same-origin admin session contract",
    "Admin access cannot be verified",
    "sessionStatus.kind",
    "No privileged data is loaded",
    "canRenderProtectedAdminContent",
    "protected-admin-slot"
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) failures.push(`ProtectedAdminShell missing ${fragment}`);
  }
  if (/admin@example|tenant id|feed count|saved entries|admin metrics/iu.test(source)) {
    failures.push("ProtectedAdminShell contains fake privileged-looking data");
  }
}

function assertRuntimeSentinelSafety() {
  const nginx = readText("nginx.conf");
  const required = [
    "location = /admin-auth/session",
    'return 501 \'{"status":"not_configured","authenticated":false,"message":"Admin authentication is not configured."}\'',
    "location ^~ /admin-auth/",
    "return 404",
    "return 405",
    'add_header Cache-Control "no-store, no-cache, must-revalidate" always',
    "default_type application/json"
  ];
  for (const fragment of required) {
    if (!nginx.includes(fragment)) failures.push(`nginx sentinel route missing ${fragment}`);
  }

  const sessionBlock = extractBlock(nginx, "location = /admin-auth/session");
  const adminAuthBlock = extractBlock(nginx, "location ^~ /admin-auth/");
  if (sessionBlock.includes("proxy_pass") || adminAuthBlock.includes("proxy_pass")) {
    failures.push("admin-auth routes must not proxy upstream");
  }

  const harness = readText("scripts/auth-session-sentinel-harness.mjs");
  const harnessRequired = [
    '"/admin-auth/session"',
    '"/admin-auth/session?token=example"',
    'method: "POST"',
    '"/admin-auth/unknown"',
    "setCookie === null",
    "wwwAuthenticate === null",
    "records.length === 0",
    "no-store",
    "ADMIN_UI_API_BASE_URL",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN"
  ];
  for (const fragment of harnessRequired) {
    if (!harness.includes(fragment)) failures.push(`auth-session sentinel harness missing ${fragment}`);
  }
}

function assertHealthClientSafety() {
  const source = readText("src/status/healthClient.ts");
  const required = [
    'credentials: "omit"',
    'cache: "no-store"',
    'method: "GET"',
    'headers: {',
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
    readText(".docs/api-auth-contract.md"),
    readText("README.md"),
    readText("PRODUCTION.md")
  ].join("\n");
  const required = [
    "REAL_AUTH_NOT_IMPLEMENTED",
    "AUTHORITY_REQUIRED_BEFORE_BUSINESS_ADMIN_FEATURES",
    "status dashboard is public read-only",
    "protected admin/business shell",
    "Agent key",
    "Tenant bearer",
    "no production deployment",
    "MS-021B",
    "SAME_ORIGIN_AUTH_SENTINEL_ONLY",
    "/admin-auth/session",
    "not_configured sentinel"
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
    { label: "agent key env", pattern: /AGENT_KEY/u },
    { label: "agent key header", pattern: /X-Agent-Key/iu },
    { label: "database url", pattern: /DATABASE_URL/u },
    { label: "private key", pattern: /PRIVATE KEY|BEGIN RSA PRIVATE KEY|BEGIN PRIVATE KEY/u },
    { label: "production env file", pattern: /\.env\.production/u },
    { label: "hardcoded bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "legacy api base", pattern: /ADMIN_UI_API_BASE_URL/u },
    { label: "server upstream origin", pattern: /ADMIN_UI_HEALTH_UPSTREAM_ORIGIN/u },
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

function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}
