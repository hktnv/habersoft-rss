import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const packageStatus = "MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR";
const priorStatus = "MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED";
const failures = [];
const corsHeaders = [
  "Access-Control-Allow-Origin",
  "Access-Control-Allow-Credentials",
  "Access-Control-Allow-Headers",
  "Access-Control-Allow-Methods",
  "Access-Control-Expose-Headers",
  "Access-Control-Max-Age"
];
const tempRoot = path.join(repoRoot, ".tmp", "ms024a-auth-enablement-verify");

try {
  assertRequiredFiles();
  assertPackageScripts();
  assertProxyCorsHardening();
  assertRedactedSmokeTool();
  assertDocs();
  assertBackendEnvFileVerifier();

  if (failures.length > 0) {
    for (const failure of failures) console.error(`ms024a-auth-enablement-verify: ${failure}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "ms024a-auth-enablement-verify-ok",
        admin_ui_state: packageStatus,
        prior_status_dashboard_state: priorStatus,
        status_api_cors_headers_hidden: corsHeaders.length,
        admin_auth_cors_headers_hidden: corsHeaders.length,
        redacted_auth_smoke_tool: "present",
        backend_env_file_verifier: "present",
        production_contact: false,
        real_secret_use: false,
        output: "redacted"
      },
      null,
      2
    )
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function assertRequiredFiles() {
  for (const file of [
    "README.md",
    "PRODUCTION.md",
    "nginx.conf",
    "docker-entrypoint.sh",
    "package.json",
    ".docs/production-activation-package.md",
    ".docs/live-status-dashboard-acceptance.md",
    ".docs/admin-auth-production-operator-handoff.md",
    "deploy/production/operator-managed.env.template",
    "deploy/production/backend-admin-auth.env.template",
    "scripts/admin-auth-smoke.mjs",
    "scripts/admin-auth-smoke-harness.mjs",
    "scripts/ms024a-auth-enablement-verify.mjs",
    "scripts/auth-proxy-harness.mjs",
    "scripts/proxy-security-harness.mjs",
    "../README.md",
    "../PRODUCTION.md",
    "../rss-habersoft-com/.docs/admin-auth-production-activation.md",
    "../rss-habersoft-com/scripts/admin-auth-provisioning.mjs"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const pkg = JSON.parse(readFrontend("package.json"));
  const scripts = pkg.scripts ?? {};
  const required = {
    "auth-smoke:redacted": "node scripts/admin-auth-smoke.mjs",
    "test:admin-auth-smoke-redacted": "node scripts/admin-auth-smoke-harness.mjs",
    "verify:ms024a-auth-enablement-package": "node scripts/ms024a-auth-enablement-verify.mjs",
    "test:auth-proxy": "node scripts/auth-proxy-harness.mjs",
    "test:proxy-security": "node scripts/proxy-security-harness.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertProxyCorsHardening() {
  const nginx = readFrontend("nginx.conf");
  const entrypoint = readFrontend("docker-entrypoint.sh");
  const runtimeTemplate = `${nginx}\n${entrypoint}`;
  const proxyHarness = readFrontend("scripts/proxy-security-harness.mjs");
  const authHarness = readFrontend("scripts/auth-proxy-harness.mjs");

  for (const header of corsHeaders) {
    const directive = `proxy_hide_header ${header};`;
    if (countOccurrences(runtimeTemplate, directive) < 2) failures.push(`runtime status proxy missing ${directive}`);
    if (countOccurrences(entrypoint, directive) < 3) failures.push(`admin auth proxy template missing ${directive}`);
    if (!proxyHarness.includes(header) || !authHarness.includes(header)) {
      failures.push(`harnesses do not exercise hidden CORS header ${header}`);
    }
  }

  for (const fragment of [
    "assertNoCorsHeaders(results.live.headers",
    "assertNoCorsHeaders(results.ready.headers",
    "assertNoCorsHeaders(results.session.headers",
    "assertNoCorsHeaders(results.login.headers",
    "assertNoCorsHeaders(results.logout.headers",
    "proxy_hide_header Set-Cookie;",
    "proxy_hide_header WWW-Authenticate;",
    "proxy_pass_request_headers off;",
    "proxy_pass_request_body off;"
  ]) {
    if (!`${nginx}\n${entrypoint}\n${proxyHarness}\n${authHarness}`.includes(fragment)) {
      failures.push(`proxy hardening evidence missing ${fragment}`);
    }
  }
}

function assertRedactedSmokeTool() {
  const smoke = readFrontend("scripts/admin-auth-smoke.mjs");
  const harness = readFrontend("scripts/admin-auth-smoke-harness.mjs");

  for (const fragment of [
    "ADMIN_AUTH_SMOKE_BASE_URL",
    "ADMIN_AUTH_SMOKE_USERNAME",
    "ADMIN_AUTH_SMOKE_PASSWORD",
    "ADMIN_AUTH_SMOKE_TMP_DIR",
    "credentials must be supplied through ADMIN_AUTH_SMOKE_USERNAME",
    "mkdtemp",
    "cookie.jar",
    "temp_cookie_jar_deleted",
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "AUTH_CONFIGURED_UNAUTHENTICATED",
    "LOGOUT_ACCEPTED_SESSION_CLEARED",
    "output: \"redacted\""
  ]) {
    if (!smoke.includes(fragment)) failures.push(`redacted smoke tool missing ${fragment}`);
  }

  for (const fragment of [
    "assertSanitized",
    "synthetic-ms024a-password",
    "opaque-ms024a-cookie",
    "temporary cookie jars remained",
    "session-classification",
    "login-smoke"
  ]) {
    if (!harness.includes(fragment)) failures.push(`redacted smoke harness missing ${fragment}`);
  }

  const forbidden = /console\.log\(.*password|set-cookie\s*:/iu;
  if (forbidden.test(smoke)) failures.push("redacted smoke tool contains forbidden raw credential/header surface");
}

function assertDocs() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/live-status-dashboard-acceptance.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend(".docs/admin-auth-production-activation.md"),
    readFrontend("deploy/production/operator-managed.env.template"),
    readFrontend("deploy/production/backend-admin-auth.env.template")
  ].join("\n");

  for (const fragment of [
    packageStatus,
    priorStatus,
    "AUTH_NOT_CONFIGURED_RESIDUAL",
    "MS-023D status-dashboard production transport remains accepted",
    "placing values only in `rss-admin-ui/.env.production` is insufficient",
    "backend API service runtime",
    "backend runtime admin-auth env placement",
    "backend API restart/recreate",
    "/admin-auth/session -> 501 not_configured",
    "backend auth is not active at the proxied upstream",
    "npm run auth-smoke:redacted",
    "npm run test:admin-auth-smoke-redacted",
    "npm run verify:ms024a-auth-enablement-package",
    "no CORS broadening",
    "redacted login/session/logout evidence",
    "Do not paste real admin credentials",
    "No production deployment",
    "no registry",
    "no Git tag",
    "rollback baseline is operator-managed"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-024A fragment: ${fragment}`);
  }

  for (const pattern of [
    /\bproduction admin auth\s+(?:is|has been)\s+enabled\b/iu,
    /\bauthenticated admin(?:-shell)? production acceptance (?:is )?(?:accepted|complete|passed)\b/iu,
    /\bvalid login\s+(?:is|has been)\s+accepted\b/iu
  ]) {
    if (pattern.test(docs)) failures.push(`docs contain forbidden auth-success claim: ${pattern}`);
  }
}

function assertBackendEnvFileVerifier() {
  mkdirSync(tempRoot, { recursive: true });
  const validEnv = [
    "APP_ENV=production",
    "ADMIN_UI_AUTH_MODE=single_admin",
    "ADMIN_UI_ADMIN_USERNAME=synthetic-admin",
    "ADMIN_UI_ADMIN_PASSWORD_HASH=pbkdf2-sha256$120000$bXMwMjNhLXIyLXBhY2thZ2Utc2FsdC0wMA$kIDFpLaX3lmgcOPk3F7v4BA4CvFutkhDEQ199HSlZlQ",
    "ADMIN_UI_SESSION_SECRET=synthetic_ms024a_admin_session_secret_48_bytes_minimum",
    "ADMIN_UI_SESSION_TTL_SECONDS=900",
    "ADMIN_UI_SESSION_COOKIE_NAME=habersoft_admin_session",
    "ADMIN_UI_SESSION_COOKIE_SECURE=true",
    "ADMIN_UI_SESSION_REDIS_PREFIX=admin_auth:production"
  ].join("\n");

  const cases = [
    { name: "valid", body: validEnv, ok: true },
    { name: "placeholder", body: validEnv.replace("synthetic-admin", "<operator-provided-admin-username>"), ok: false },
    { name: "short-secret", body: validEnv.replace("synthetic_ms024a_admin_session_secret_48_bytes_minimum", "too-short"), ok: false },
    { name: "invalid-hash", body: validEnv.replace("pbkdf2-sha256$120000$bXMwMjNhLXIyLXBhY2thZ2Utc2FsdC0wMA$kIDFpLaX3lmgcOPk3F7v4BA4CvFutkhDEQ199HSlZlQ", "not-a-hash"), ok: false },
    { name: "disabled", body: validEnv.replace("ADMIN_UI_AUTH_MODE=single_admin", "ADMIN_UI_AUTH_MODE=disabled"), ok: false },
    { name: "missing", body: validEnv.replace(/^ADMIN_UI_ADMIN_PASSWORD_HASH=.*\n?/mu, ""), ok: false }
  ];

  for (const item of cases) {
    const file = path.join(tempRoot, `${item.name}.env`);
    writeFileSync(file, `${item.body}\n`, { encoding: "utf8", mode: 0o600 });
    const result = run("npm", ["run", "admin-auth:verify-config", "--", "--env-file", file, "--require-enabled"], {
      cwd: backendRoot
    });
    if (item.ok && result.status !== 0) failures.push(`backend env-file verifier rejected ${item.name}: ${result.stderr}`);
    if (!item.ok && result.status === 0) failures.push(`backend env-file verifier accepted ${item.name}`);
    const combined = `${result.stdout}\n${result.stderr}`;
    for (const forbidden of [
      "synthetic_ms024a_admin_session_secret_48_bytes_minimum",
      "pbkdf2-sha256$120000",
      "too-short"
    ]) {
      if (combined.includes(forbidden)) failures.push(`backend env-file verifier printed sensitive value for ${item.name}`);
    }
  }

  const provisioning = readBackend("scripts/admin-auth-provisioning.mjs");
  for (const fragment of [
    "--env-file",
    "refusing to read ms-023a-secrets.json",
    "must not be a placeholder",
    "ADMIN_UI_AUTH_MODE must be single_admin for activation",
    "ADMIN_UI_SESSION_SECRET must be at least 32 UTF-8 bytes",
    "ADMIN_UI_ADMIN_PASSWORD_HASH must use the pbkdf2-sha256 encoded hash format"
  ]) {
    if (!provisioning.includes(fragment)) failures.push(`backend provisioning verifier missing ${fragment}`);
  }
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

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) failures.push(`missing required file: ${label}`);
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
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
