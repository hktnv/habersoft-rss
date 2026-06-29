import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const packageStatus = "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED";
const upstreamNames = ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"];
const publicEdgeOrigins = [
  "https://rss.habersoft.com",
  "http://rss.habersoft.com",
  "https://rss-panel.habersoft.com",
  "http://rss-panel.habersoft.com"
];
const loopbackOrigins = [
  "http://127.0.0.1:3200",
  "http://localhost:3200",
  "http://[::1]:3200",
  "http://0.0.0.0:3200"
];
const safeInternalExamples = [
  "http://host.docker.internal:3200",
  "http://main-service-api:3000"
];
const failures = [];

assertPackageScripts();
assertTemplateContract();
assertOriginValidator();
assertEntrypointContract();
assertComposeExamples();
assertDocsContract();
assertBrowserSurface();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-upstream-contract-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-upstream-contract-verify-ok",
      admin_ui_state: packageStatus,
      public_edge_upstreams_rejected: publicEdgeOrigins.length,
      loopback_upstreams_rejected: loopbackOrigins.length,
      internal_examples_accepted: safeInternalExamples.length,
      browser_upstream_leak: false,
      production_contact: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertPackageScripts() {
  const pkg = JSON.parse(readFrontend("package.json"));
  const scripts = pkg.scripts ?? {};
  const required = {
    "verify:production-upstream-contract": "node scripts/production-upstream-contract-verify.mjs",
    "verify:live-evidence-intake": "node scripts/live-evidence-intake-verify.mjs",
    "verify:admin-auth-not-configured-remediation": "node scripts/live-evidence-intake-verify.mjs",
    "test:status-api-upstream-remediation": "node scripts/status-api-upstream-remediation-harness.mjs",
    "test:status-api-production-networking": "node scripts/status-api-upstream-remediation-harness.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertTemplateContract() {
  const operatorTemplate = readFrontend("deploy/production/operator-managed.env.template");
  const productionTemplate = readFrontend("deploy/production/production.env.template");

  for (const fragment of [
    "Preferred backend-network service DNS mode",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>",
    "Host-gateway mode is allowed only after the operator proves reachability",
    "Do not set ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "Do not set ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "Do not set ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200",
    "Do not set ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200",
    "localhost, ::1, [::1], or 0.0.0.0",
    "https://rss-panel.habersoft.com",
    "host.docker.internal:3200",
    "main-service-api:3000",
    "backend-admin-auth.env.template",
    "does not enable backend auth",
    "keep ADMIN_UI_HEALTH_UPSTREAM_ORIGIN unchanged"
  ]) {
    if (!operatorTemplate.includes(fragment)) failures.push(`operator template missing ${fragment}`);
  }

  for (const [name, value] of Object.entries(parseEnvAssignments(operatorTemplate))) {
    if (upstreamNames.includes(name) && value !== "") assertAcceptedInternalOrigin(value, `operator template ${name}`);
  }

  for (const [name, value] of Object.entries(parseEnvAssignments(productionTemplate))) {
    if (upstreamNames.includes(name) && value !== "") assertAcceptedInternalOrigin(value, `production template ${name}`);
  }
}

function assertOriginValidator() {
  for (const origin of safeInternalExamples) {
    assertAcceptedInternalOrigin(origin, "safe internal example");
  }
  for (const origin of publicEdgeOrigins) {
    assertRejectedPublicEdgeOrigin(origin, "known public edge anti-pattern");
  }
  for (const origin of loopbackOrigins) {
    assertRejectedLoopbackOrigin(origin, "known Docker bridge loopback anti-pattern");
  }

  for (const invalid of [
    "ftp://main-service-api:3000",
    "http://user:pass@main-service-api:3000",
    "http://main-service-api:3000/health",
    "http://main-service-api:3000?target=/health/ready",
    "http://main-service-api:3000#fragment"
  ]) {
    assertRejectedInvalidOrigin(invalid, "invalid origin shape");
  }
}

function assertEntrypointContract() {
  const entrypoint = readFrontend("docker-entrypoint.sh");
  for (const fragment of [
    "rss.habersoft.com",
    "rss-panel.habersoft.com",
    "must be an internal backend origin",
    "container-local or unspecified loopback host",
    "backend-network service DNS",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN"
  ]) {
    if (!entrypoint.includes(fragment)) failures.push(`entrypoint missing upstream contract fragment: ${fragment}`);
  }

  const nginx = readFrontend("nginx.conf");
  for (const fragment of [
    "proxy_intercept_errors on;",
    "error_page 401 403 = @status_api_upstream_forbidden;",
    "error_page 500 502 504 = @status_api_upstream_unavailable;",
    "location @status_api_upstream_forbidden",
    "location @status_api_upstream_unavailable",
    "\"reason\":\"upstream_forbidden\"",
    "\"reason\":\"upstream_unavailable\"",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;"
  ]) {
    if (!nginx.includes(fragment)) failures.push(`nginx missing upstream remediation fragment: ${fragment}`);
  }
}

function assertComposeExamples() {
  for (const origin of safeInternalExamples) {
    const result = run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
      cwd: frontendRoot,
      env: productionComposeEnv(origin)
    });
    if (result.status !== 0) failures.push(`production compose did not render internal upstream example: ${redactedOriginKind(origin)}`);
  }

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
      ADMIN_UI_ADMIN_PASSWORD_HASH: "pbkdf2-sha256$120000$bXMwMjNiLXVwc3RyZWFtLTAw$Lv9lJTd4qyEV0qIYDy5Za3XfcVN58bDSEJI5EIovXVk",
      ADMIN_UI_SESSION_SECRET: "synthetic_ms023d_upstream_contract_secret_48_bytes_minimum",
      ADMIN_UI_SESSION_TTL_SECONDS: "900",
      ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
      ADMIN_UI_SESSION_COOKIE_SECURE: "false",
      ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:ms023d",
      ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
      ADMIN_UI_ENVIRONMENT_NAME: "upstream-contract-local",
      ADMIN_UI_HOST_PORT: "8081"
    }
  });
  if (rootCompose.status !== 0) failures.push("root compose did not render with synthetic internal upstream env");

  const overlayCompose = run(
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
        ...productionComposeEnv("http://main-service-api:3000"),
        ADMIN_UI_BACKEND_DOCKER_NETWORK: "main-service-production_default"
      }
    }
  );
  if (overlayCompose.status !== 0) failures.push("backend-network production compose overlay did not render with synthetic env");
}

function assertDocsContract() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/same-origin-health-transport.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readFrontend(".docs/status-api-upstream-remediation.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md")
  ].join("\n");

  for (const fragment of [
    packageStatus,
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "codex_public_readonly_verified",
    "operator-reported",
    "public `https://rss-panel.habersoft.com/status-api/health/ready` still returns `502`",
    "container-loopback upstream misconfiguration",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com",
    "Do not use 127.0.0.1",
    "ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>",
    "compose.backend-network.yaml",
    "http://127.0.0.1:3200",
    "http://host.docker.internal:3200",
    "http://main-service-api:3000",
    "npm run verify:production-upstream-contract",
    "npm run verify:live-evidence-intake",
    "npm run verify:admin-auth-not-configured-remediation",
    "npm run test:status-api-production-networking",
    "npm run test:status-api-upstream-remediation",
    "Authenticated admin-shell production acceptance remains pending"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing upstream contract fragment: ${fragment}`);
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
    { label: "health upstream env", pattern: /ADMIN_UI_HEALTH_UPSTREAM_ORIGIN/u },
    { label: "auth upstream env", pattern: /ADMIN_UI_AUTH_UPSTREAM_ORIGIN/u },
    { label: "public backend edge host", pattern: /rss\.habersoft\.com/iu },
    { label: "public panel edge host", pattern: /rss-panel\.habersoft\.com/iu },
    { label: "internal upstream origin", pattern: /main-service-api:3000|host\.docker\.internal:3200|127\.0\.0\.1:3200/iu },
    { label: "agent key", pattern: /AGENT_KEY|X-Agent-Key/iu },
    { label: "database url", pattern: /DATABASE_URL/u },
    { label: "browser auth persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
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

function productionComposeEnv(origin) {
  return {
    RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: origin,
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: origin,
    ADMIN_UI_ENVIRONMENT_NAME: "production-upstream-contract-local",
    ADMIN_UI_HOST_PORT: "8081"
  };
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

function assertAcceptedInternalOrigin(origin, label) {
  const result = classifyOrigin(origin);
  if (!result.ok || result.publicEdge) failures.push(`${label} was not accepted as internal: ${redactedOriginKind(origin)}`);
}

function assertRejectedPublicEdgeOrigin(origin, label) {
  const result = classifyOrigin(origin);
  if (result.ok || !result.publicEdge) failures.push(`${label} was not rejected as public edge`);
}

function assertRejectedLoopbackOrigin(origin, label) {
  const result = classifyOrigin(origin);
  if (result.ok || !result.loopback) failures.push(`${label} was not rejected as Docker bridge loopback`);
}

function assertRejectedInvalidOrigin(origin, label) {
  const result = classifyOrigin(origin);
  if (result.ok) failures.push(`${label} was accepted unexpectedly: ${redactedOriginKind(origin)}`);
}

function classifyOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, publicEdge: false };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, publicEdge: false };
  if (parsed.username !== "" || parsed.password !== "") return { ok: false, publicEdge: false };
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return { ok: false, publicEdge: false };
  if (parsed.hostname === "") return { ok: false, publicEdge: false };

  let hostname = parsed.hostname.replace(/\.$/u, "").toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  const publicEdge = hostname === "rss.habersoft.com" || hostname === "rss-panel.habersoft.com";
  if (publicEdge) return { ok: false, publicEdge: true, loopback: false };
  const loopback = hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0" || hostname.startsWith("127.");
  if (loopback) return { ok: false, publicEdge: false, loopback: true };

  return { ok: true, publicEdge: false, loopback: false };
}

function redactedOriginKind(origin) {
  if (origin.includes("127.0.0.1")) return "host-loopback";
  if (origin.includes("host.docker.internal")) return "host-gateway";
  if (origin.includes("main-service-api")) return "service-dns";
  return "origin";
}

function readRoot(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

function readFrontend(relative) {
  return readFileSync(path.join(frontendRoot, relative), "utf8");
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
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
