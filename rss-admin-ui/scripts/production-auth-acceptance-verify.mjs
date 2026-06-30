import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const ms024fStatus = "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED";
const ms024eStatus = "MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING";
const acceptedAuthShell = "AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED";
const failures = [];

assertPackageScript();
assertRequiredFiles();
assertDocs();
assertBrowserStatusCopy();
assertNoUnsafeTrackedArtifacts();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-auth-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-auth-acceptance-verify-ok",
      admin_ui_state: ms024fStatus,
      evidence_source: "operator_reported",
      status_dashboard: "accepted",
      authenticated_admin_shell: "accepted_operator_reported",
      future_business_features: "not_accepted",
      codex_credentialed_login: false,
      production_mutation: false,
      real_secret_use: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertPackageScript() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  if (scripts["verify:production-auth-acceptance"] !== "node scripts/production-auth-acceptance-verify.mjs") {
    failures.push("package.json missing verify:production-auth-acceptance");
  }
}

function assertRequiredFiles() {
  for (const file of [
    "../README.md",
    "../PRODUCTION.md",
    "README.md",
    "PRODUCTION.md",
    ".docs/production-activation-package.md",
    ".docs/live-status-dashboard-acceptance.md",
    ".docs/status-api-upstream-remediation.md",
    ".docs/admin-auth-production-operator-handoff.md",
    "../rss-habersoft-com/README.md",
    "../rss-habersoft-com/PRODUCTION.md",
    "../rss-habersoft-com/.docs/admin-auth-production-activation.md",
    "src/status/StatusDashboard.tsx",
    "tests/app-shell.test.tsx"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertDocs() {
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

  for (const fragment of [
    ms024fStatus,
    ms024eStatus,
    "operator_reported",
    "operator-reported",
    "authenticated admin shell production acceptance",
    "Codex did not independently perform a credentialed login",
    "no production mutation",
    "status dashboard production scope remains accepted",
    "future business/admin write features are not accepted",
    "auth-smoke:redacted remains a redacted regression/sanity tool",
    "No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains",
    "npm run ops:compose:recreate",
    "no registry",
    "no Git tag",
    "no GitHub Release",
    "no PR"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-024F claim-boundary fragment: ${fragment}`);
  }

  for (const forbidden of [
    /\bCodex (?:logged in|performed a credentialed login|used real admin credentials)\b/iu,
    /\bwe (?:logged in|used real admin credentials)\b/iu,
    /\breal admin credentials (?:were|are) (?:verified|stored|hashed|read)\b/iu,
    /\bfuture business\/admin write features are accepted\b/iu,
    /\blong-term stability\b[^\n]{0,80}\b(?:proposed|required|performed)\b/iu,
    /E:\\Codex\\rss-habersoft-com\\workplace\\ms-[^`\s]+/iu
  ]) {
    if (forbidden.test(docs)) failures.push(`docs contain forbidden MS-024F claim: ${forbidden}`);
  }
}

function assertBrowserStatusCopy() {
  const dashboard = readFrontend("src/status/StatusDashboard.tsx");
  const appTest = readFrontend("tests/app-shell.test.tsx");
  for (const fragment of [
    "READ_ONLY_STATUS_DASHBOARD_PRODUCTION_TRANSPORT_ACTIVE",
    acceptedAuthShell,
    "OUT_OF_SCOPE"
  ]) {
    if (!dashboard.includes(fragment)) failures.push(`dashboard status copy missing ${fragment}`);
    if (!appTest.includes(fragment)) failures.push(`app shell test missing ${fragment}`);
  }
  if (dashboard.includes("AUTH_NOT_CONFIGURED_RESIDUAL")) failures.push("dashboard still renders old auth residual");
}

function assertNoUnsafeTrackedArtifacts() {
  const files = [
    ...collectFiles(path.join(frontendRoot, "src")),
    ...collectFiles(path.join(frontendRoot, "public")),
    path.join(frontendRoot, "index.html"),
    ...collectFiles(path.join(frontendRoot, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile());

  const forbidden = [
    { label: "agent key", pattern: /AGENT_KEY|X-Agent-Key/iu },
    { label: "tenant bearer", pattern: /bearer\s+[a-z0-9._~+/-]{12,}/iu },
    { label: "session secret", pattern: /ADMIN_UI_SESSION_SECRET|session_secret/iu },
    { label: "password hash", pattern: /ADMIN_UI_ADMIN_PASSWORD_HASH|pbkdf2-sha256\$/iu },
    { label: "browser credential persistence", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u },
    { label: "temporary task root", pattern: /E:\\Codex\\rss-habersoft-com\\workplace\\ms-/iu },
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
