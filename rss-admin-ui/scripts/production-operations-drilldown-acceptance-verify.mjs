import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const summaryStatus = "MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const shellStatus = "MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED";
const route = "/admin-api/operations/drilldown";
const failures = [];

assertRequiredFiles();
assertPackageScripts();
assertDocsContract();
assertVerifierContracts();
assertNoUnsafeTrackedClaims();
assertNoTemporaryWorkplaceOperatorInstructions();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-operations-drilldown-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-operations-drilldown-acceptance-verify-ok",
      milestone: status,
      evidence_source: "operator_reported",
      status_dashboard: "accepted",
      authenticated_admin_shell: "accepted_operator_reported",
      read_only_operations_dashboard: "accepted_operator_reported",
      read_only_operations_drilldown: "accepted_operator_reported",
      auth_configured_unauthenticated_without_credentials: "observation_not_blocker",
      auth_login_attempt_failed_with_credentials: "blocker",
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
    "docker-entrypoint.sh",
    ".docs/admin-operations-dashboard.md",
    ".docs/admin-auth-production-operator-handoff.md",
    ".docs/admin-auth-session-boundary.md",
    ".docs/api-auth-contract.md",
    ".docs/production-activation-package.md",
    "scripts/admin-operations-drilldown-verify.mjs",
    "scripts/admin-api-proxy-template-harness.mjs",
    "scripts/production-operations-acceptance-verify.mjs",
    "scripts/production-operations-drilldown-acceptance-verify.mjs",
    "../rss-habersoft-com/README.md",
    "../rss-habersoft-com/PRODUCTION.md",
    "../rss-habersoft-com/.docs/admin-operations-drilldown-api.md",
    "../rss-habersoft-com/.docs/admin-operations-summary-api.md",
    "../rss-habersoft-com/test/admin-api/admin-operations-drilldown.controller.spec.ts"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }
}

function assertPackageScripts() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  const required = {
    "verify:production-operations-drilldown-acceptance": "node scripts/production-operations-drilldown-acceptance-verify.mjs",
    "verify:production-operations-acceptance": "node scripts/production-operations-acceptance-verify.mjs",
    "verify:admin-operations-drilldown": "node scripts/admin-operations-drilldown-verify.mjs",
    "test:admin-api-proxy-template": "node scripts/admin-api-proxy-template-harness.mjs",
    "auth-smoke:redacted": "node scripts/admin-auth-smoke.mjs"
  };
  for (const [name, command] of Object.entries(required)) {
    if (scripts[name] !== command) failures.push(`package.json missing ${name}`);
  }
}

function assertDocsContract() {
  const docs = docsText();
  const requiredFragments = [
    status,
    summaryStatus,
    shellStatus,
    "MS-023D status dashboard accepted",
    "operator_reported",
    "operator-reported",
    "authenticated read-only Operations Drilldown dashboard",
    "drilldown production acceptance is closed",
    "operator-reported MS-025B-R1 live retest evidence",
    "Backend image was rebuilt",
    "Migration control/check passed",
    "main-service-api and main-service-worker were recreated",
    "Frontend image was rebuilt",
    "Current latest-tag pattern was preserved",
    "Frontend was recreated with the canonical helper",
    "GET /healthz -> 200 OK",
    "GET /status-api/health/live -> JSON 200",
    "GET /status-api/health/ready -> JSON 200",
    `unauthenticated \`GET ${route} -> JSON 401`,
    "GET /admin-api/foo -> JSON 404",
    "running Nginx config contained both `/admin-api/operations/drilldown` and `/admin-api/operations/summary`",
    "running Nginx config had no unresolved `__ADMIN_UI_` markers",
    "Operations Overview rendered successfully",
    "Operations Drilldown rendered successfully",
    "Drilldown JSON data loaded successfully",
    "sign out returned the drilldown route to the unauthenticated/locked state",
    "Codex did not independently perform a credentialed production login",
    "No secret, cookie, or session value was shared",
    "No production deployment was performed by Codex for MS-025B-R1",
    "auth-smoke without credentials remains a sanity observation, not a blocker",
    "`AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails",
    "future admin write/business features are not accepted",
    "write/business features remain separate bounded milestones",
    "durable operator-state receipt outside Git",
    "temporary workplace paths are not durable operator artifacts"
  ];

  for (const fragment of requiredFragments) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-025B-R1 fragment: ${fragment}`);
  }
}

function assertVerifierContracts() {
  const drilldownVerifier = readFrontend("scripts/admin-operations-drilldown-verify.mjs");
  const activationVerifier = readFrontend("scripts/production-activation-package-verify.mjs");
  const readinessVerifier = readFrontend("scripts/production-readiness-verify.mjs");

  for (const [label, text] of [
    ["admin drilldown verifier", drilldownVerifier],
    ["activation verifier", activationVerifier],
    ["readiness verifier", readinessVerifier]
  ]) {
    if (!text.includes(status)) failures.push(`${label} does not reference ${status}`);
  }

  if (!readinessVerifier.includes("verify:production-operations-drilldown-acceptance")) {
    failures.push("production readiness verifier does not run drilldown acceptance verifier");
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
    /\blong-term stability\b[^\n]{0,80}\b(?:proposed|required|performed)\b/iu,
    /\bnew drilldown production acceptance is pending operator deploy\/retest\b/iu,
    /\bMS-025B\b[^\n]{0,140}\bpending operator deploy\/retest\b/iu
  ];
  for (const pattern of forbiddenClaims) {
    if (pattern.test(docs)) failures.push(`docs contain forbidden MS-025B-R1 claim: ${pattern}`);
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
    readFrontend(".docs/admin-auth-session-boundary.md"),
    readFrontend(".docs/api-auth-contract.md"),
    readFrontend(".docs/production-activation-package.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md"),
    readBackend(".docs/admin-operations-drilldown-api.md"),
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
