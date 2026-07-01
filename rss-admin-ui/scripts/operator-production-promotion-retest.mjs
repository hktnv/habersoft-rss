import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskClass, riskSummary } from "./operator-risk-model.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const args = process.argv.slice(2);
const apply = args.includes("--apply") || process.env.OPERATOR_PROMOTION_APPLY === "true";
const retestOnly = args.includes("--retest-only");
const dryRun = args.includes("--dry-run") || (!apply && !retestOnly);
const receiptOut = optionValue("--receipt-out") ?? optionValue("--receipt-file") ?? process.env.OPERATOR_PROMOTION_RECEIPT_FILE;
const endpoint = optionValue("--endpoint") ?? optionValue("--base-url") ?? process.env.OPERATOR_RETEST_BASE_URL ?? "http://127.0.0.1:8081";
const nginxConfigFile = optionValue("--nginx-config-file") ?? process.env.OPERATOR_NGINX_CONFIG_FILE;
const browserEvidenceFile = optionValue("--browser-evidence") ?? process.env.OPERATOR_BROWSER_EVIDENCE_FILE;
const skipBackendRecreate = args.includes("--skip-backend-recreate");
const skipFrontendRecreate = args.includes("--skip-frontend-recreate");
const migrationCheck = args.includes("--migration-check");
const attemptFeedRecheck = args.includes("--attempt-feed-recheck");
const operatorClassificationCatalog = [
  "source_not_promoted",
  "backend_image_stale",
  "frontend_image_stale",
  "backend_route_missing",
  "frontend_route_missing",
  "nginx_template_marker_unresolved",
  "auth_not_configured",
  "unauthenticated_expected",
  "no_eligible_feed_target",
  "accepted_route_smoke_pending_effect"
];

if (args.includes("--help") || args.includes("-h")) {
  writeJson({
    status: "operator-production-promotion-retest-help",
    usage: "npm run ops:production:retest -- [--dry-run|--retest-only|--apply] [--endpoint URL] [--nginx-config-file FILE] [--browser-evidence FILE] [--receipt-out FILE]",
    default: "dry-run plan, no mutation, no HTTP acceptance",
    apply_policy: "--apply allows operator-owned backend/frontend recreate helpers and then redacted retest",
    retest_only_policy: "--retest-only performs route/auth/admin-api acceptance without recreate",
    credential_policy: "admin credentials are accepted only through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD by the lower-level smoke scripts",
    output: "redacted"
  });
  process.exit(0);
}

if (args.some((arg) => /^--(?:username|password|cookie|csrf|token|idempotency|actionRef|secret|authorization|bearer|feedUrl|feed-url)(?:=|$)/iu.test(arg))) {
  fail("credentials, cookies, CSRF tokens, idempotency keys, actionRefs, feed URLs, and secrets must not be supplied on command lines");
}
if (apply && args.includes("--dry-run")) fail("--apply and --dry-run cannot be combined");
if (apply && retestOnly) fail("--apply and --retest-only cannot be combined");

const baseUrl = normalizeBaseUrl(endpoint);
const git = gitSummary();
const roots = rootSummary();
const operatorFiles = operatorFileSummary();
const warnings = [];
const critical = [];
const steps = [];
const operatorClassifications = new Set(sourcePromotionClassifications(git));

if (nginxConfigFile === undefined) {
  warnings.push(riskClass("ROUTE_PROOF_NOT_AVAILABLE", "provide --nginx-config-file with running/generated Nginx config for route proof"));
}
if (browserEvidenceFile === undefined && !process.env.ADMIN_AUTH_SMOKE_USERNAME && !process.env.ADMIN_AUTH_SMOKE_PASSWORD) {
  warnings.push(riskClass("AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED", "credentials absent; browser evidence can close authenticated read-only checks"));
}
if (!operatorFiles.backend.envProduction || !operatorFiles.backend.runtimeImageEnv) {
  warnings.push(riskClass("BACKEND_AUTH_ENV_NOT_WIRED", "backend production env/runtime image files are not present in this checkout"));
}
if (!operatorFiles.frontend.envProduction) {
  warnings.push(riskClass("OPTIONAL_ENV_DEFAULTED", "frontend .env.production is not present; compose helper may still produce a safe plan"));
}

if (dryRun) {
  await finish({
    status: "OPERATOR_PROMOTION_RETEST_DRY_RUN_READY",
    mode: "dry-run",
    git,
    roots,
    operator_files: operatorFiles,
    planned_steps: plannedSteps(),
    operator_classifications: [...operatorClassifications],
    classification_catalog: operatorClassificationCatalog,
    receipt: {
      will_write: receiptOut !== undefined,
      path: receiptOut === undefined ? "not-requested" : path.resolve(receiptOut)
    },
    risk: {
      warnings,
      critical,
      model: riskSummary()
    },
    output: "redacted"
  }, false);
  process.exit(0);
}

if (apply && operatorClassifications.has("source_not_promoted")) {
  critical.push(riskClass("SOURCE_NOT_PROMOTED", "current checkout does not match origin/main; run git pull --ff-only origin main before --apply"));
  await finish({
    status: "OPERATOR_PROMOTION_RETEST_ATTENTION_REQUIRED",
    mode: "apply",
    git,
    roots,
    operator_files: operatorFiles,
    operator_classifications: [...operatorClassifications],
    classification_catalog: operatorClassificationCatalog,
    risk: {
      warnings,
      critical,
      model: riskSummary()
    },
    output: "redacted"
  }, true);
  process.exit(1);
}

if (migrationCheck) {
  steps.push(runStep("backend-migration-status", backendRoot, "migrate:status", []));
}

if (apply && !skipBackendRecreate) {
  steps.push(runStep("backend-api-worker-recreate", backendRoot, "ops:production:recreate:api-worker", ["--apply"]));
}

if (apply && !skipFrontendRecreate) {
  steps.push(runStep("frontend-compose-recreate", frontendRoot, "ops:compose:recreate", ["--apply"]));
}

const routeProof = nginxConfigFile === undefined ? routeProofMissing() : routeProofFromFile(nginxConfigFile);
if (routeProof.status !== "NGINX_ROUTE_PROOF_ACCEPTED") {
  const routeRisk = routeProof.critical === true ? riskClass("NGINX_EXACT_ADMIN_ROUTE_MISSING", routeProof.reason) : riskClass("ROUTE_PROOF_NOT_AVAILABLE", routeProof.reason);
  if (routeProof.classification !== undefined) operatorClassifications.add(routeProof.classification);
  if (routeProof.critical === true) critical.push(routeRisk);
  else warnings.push(routeRisk);
}

steps.push(runStep("frontend-redacted-acceptance", frontendRoot, "ops:production:acceptance:redacted", [
  "--endpoint",
  baseUrl.origin,
  ...(attemptFeedRecheck ? ["--attempt-feed-recheck"] : [])
]));

let browserEvidence = {
  status: browserEvidenceFile === undefined ? "BROWSER_EVIDENCE_NOT_PROVIDED" : "BROWSER_EVIDENCE_NOT_RUN",
  classifications: browserEvidenceFile === undefined ? ["BROWSER_EVIDENCE_MISSING"] : []
};
if (browserEvidenceFile !== undefined) {
  browserEvidence = runBrowserEvidenceVerifier(browserEvidenceFile);
  if (browserEvidence.status !== "browser-evidence-verify-ok") {
    critical.push(riskClass("SECRET_OR_AUTH_MATERIAL_EXPOSURE", "browser evidence verifier rejected the supplied file"));
  }
}

const failedSteps = steps.filter((step) => step.exit_code !== 0);
const acceptanceStep = steps.find((step) => step.name === "frontend-redacted-acceptance");
const acceptanceClasses = acceptanceStep?.classification === undefined ? [] : [acceptanceStep.classification];
for (const step of steps) collectStepClassifications(step, operatorClassifications);
const noEligible = acceptanceStep?.feed_recheck_effect_status === "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET" || browserEvidence.classifications.includes("BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET");
if (noEligible) {
  operatorClassifications.add("no_eligible_feed_target");
  warnings.push(riskClass("PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET", "route/auth/proxy checks can pass while effect remains pending until a real eligible feed exists"));
}
if (acceptanceStep?.feed_onboarding_classification === "FEED_ONBOARDING_ROUTE_SMOKE_ATTENTION_REQUIRED") {
  operatorClassifications.add(routeProof.status === "NGINX_ROUTE_PROOF_ACCEPTED" ? "backend_route_missing" : "frontend_route_missing");
  critical.push(riskClass("ADMIN_FEED_ONBOARDING_ROUTE_UNSAFE", "feed onboarding route smoke did not pass exact JSON auth-gated checks"));
}
if (acceptanceStep?.feed_onboarding_classification === "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED") {
  operatorClassifications.add("accepted_route_smoke_pending_effect");
}
const highApplyWarnings = apply && warnings.some((warning) => warning.tier === "HIGH");

await finish({
  status: failedSteps.length === 0 && critical.length === 0 && !highApplyWarnings ? "OPERATOR_PROMOTION_RETEST_REDACTED_OK" : "OPERATOR_PROMOTION_RETEST_ATTENTION_REQUIRED",
  mode: apply ? "apply" : "retest-only",
  git,
  roots,
  endpoint: baseUrl.origin,
  route_proof: routeProof,
  browser_evidence: browserEvidence,
  steps,
  operator_classifications: [...operatorClassifications],
  classification_catalog: operatorClassificationCatalog,
  classifications: [...acceptanceClasses, ...browserEvidence.classifications],
  feed_recheck_effect_status: noEligible ? "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET" : acceptanceStep?.feed_recheck_effect_status ?? "PENDING_OPERATOR_ACTION_OR_BROWSER_EVIDENCE",
  feed_onboarding_status: acceptanceStep?.feed_onboarding_status ?? "PENDING_ROUTE_SMOKE_OR_BROWSER_EVIDENCE",
  risk: {
    warnings,
    critical,
    model: riskSummary()
  },
  output: "redacted"
}, true);

function plannedSteps() {
  return [
    "verify checkout and current Git SHA",
    "detect backend/frontend roots and operator env/template file presence without reading secret values",
    "optional backend migration status check with --migration-check",
    "operator-owned backend current-HEAD image build, OCI label verification, runtime image pointer update, then API/worker recreate only when --apply is used",
    "operator-owned frontend current-HEAD image build, OCI label verification, env image pointer update, then compose recreate only when --apply is used",
    "running/generated Nginx route proof for summary, drilldown, feed-recheck, and feed-onboarding when --nginx-config-file is provided",
    "redacted health/status/auth/admin-api acceptance through ops:production:acceptance:redacted when --apply or --retest-only is used",
    "browser evidence verifier when --browser-evidence is provided",
    "durable redacted receipt when --apply/--retest-only or --receipt-out is used"
  ];
}

function runStep(name, cwd, npmScript, npmArgs) {
  const result = runNpm(cwd, ["run", npmScript, "--", ...npmArgs]);
  const parsed = parseJson(result.stdout);
  return {
    name,
    script: npmScript,
    exit_code: result.status ?? 1,
    status: parsed?.status ?? (result.status === 0 ? "ok" : "failed"),
    classification: parsed?.auth?.classification ?? parsed?.classification ?? parsed?.status ?? "none",
    classifications: Array.isArray(parsed?.classifications) ? parsed.classifications : [],
    image_freshness: parsed?.image_freshness ?? undefined,
    feed_recheck_classification: parsed?.feed_recheck?.classification ?? "none",
    feed_recheck_effect_status: parsed?.feed_recheck?.effect_status ?? "none",
    feed_onboarding_classification: parsed?.feed_onboarding?.classification ?? "none",
    feed_onboarding_status: parsed?.feed_onboarding?.feed_onboarding_status ?? "none",
    output: "redacted"
  };
}

function runBrowserEvidenceVerifier(file) {
  const result = spawnSync(process.execPath, ["scripts/browser-evidence-verify.mjs", "--file", file], {
    cwd: frontendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  const parsed = parseJson(result.stdout);
  return {
    status: parsed?.status ?? "browser-evidence-verify-failed",
    exit_code: result.status ?? 1,
    classifications: Array.isArray(parsed?.classifications) ? parsed.classifications : ["BROWSER_EVIDENCE_INVALID"],
    feed_recheck_effect_status: parsed?.feed_recheck_effect_status ?? "unknown",
    evidence_sha256: parsed?.evidence_sha256 ?? "unavailable",
    output: "redacted"
  };
}

function routeProofMissing() {
  return {
    status: "ROUTE_PROOF_NOT_AVAILABLE",
    reason: "no --nginx-config-file supplied",
    classification: "frontend_route_missing",
    critical: false
  };
}

function routeProofFromFile(file) {
  const absolute = path.resolve(file);
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    return {
      status: "ROUTE_PROOF_NOT_AVAILABLE",
      reason: "nginx config file could not be read",
      classification: "frontend_route_missing",
      critical: false
    };
  }
  if (/__ADMIN_UI_/u.test(text)) {
    return {
      status: "NGINX_ROUTE_PROOF_REJECTED",
      reason: "unresolved __ADMIN_UI_ marker present",
      classification: "nginx_template_marker_unresolved",
      critical: true
    };
  }
  const missing = [
    "/admin-api/operations/summary",
    "/admin-api/operations/drilldown",
    "/admin-api/operations/feed-recheck-requests",
    "/admin-api/operations/feed-onboarding-requests"
  ].filter((route) => !text.includes(route));
  if (missing.length > 0) {
    return {
      status: "NGINX_ROUTE_PROOF_REJECTED",
      reason: "exact admin route missing",
      classification: "frontend_route_missing",
      missing_routes: missing,
      critical: true
    };
  }
  return {
    status: "NGINX_ROUTE_PROOF_ACCEPTED",
    required_routes: [
      "/admin-api/operations/summary",
      "/admin-api/operations/drilldown",
      "/admin-api/operations/feed-recheck-requests",
      "/admin-api/operations/feed-onboarding-requests"
    ],
    unresolved_markers: false,
    output: "redacted"
  };
}

async function finish(payload, writeDefaultReceipt) {
  const receiptPath = receiptOut ?? (writeDefaultReceipt ? defaultReceiptPath() : undefined);
  if (receiptPath !== undefined && receiptPath !== "") {
    const absoluteReceipt = path.resolve(receiptPath);
    const payloadJson = `${JSON.stringify(payload, null, 2)}\n`;
    const receipt = {
      ...payload,
      receipt_sha256: createHash("sha256").update(payloadJson).digest("hex")
    };
    await mkdir(path.dirname(absoluteReceipt), { recursive: true });
    await writeFile(absoluteReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    payload = {
      ...payload,
      receipt: {
        path: absoluteReceipt,
        sha256: receipt.receipt_sha256,
        output: "redacted"
      }
    };
  }
  writeJson(payload);
}

function defaultReceiptPath() {
  if (process.platform === "win32") {
    return "E:\\Codex\\rss-habersoft-com\\operator-state\\admin-ui-production-activation\\ms-026c-one-command-production-retest-receipt.json";
  }
  return path.join(os.homedir(), ".habersoft-rss", "operator-state", "admin-ui-production-activation", "ms-026c-one-command-production-retest-receipt.json");
}

function sourcePromotionClassifications(gitInfo) {
  if (gitInfo.current === "unavailable" || gitInfo.origin_main === "unavailable" || gitInfo.current !== gitInfo.origin_main) {
    return ["source_not_promoted"];
  }
  return [];
}

function collectStepClassifications(step, target) {
  for (const classification of step.classifications ?? []) {
    if (operatorClassificationCatalog.includes(classification)) target.add(classification);
  }
  if (step.image_freshness?.classification === "backend_image_stale") target.add("backend_image_stale");
  if (step.image_freshness?.classification === "frontend_image_stale") target.add("frontend_image_stale");
  if (step.classification === "AUTH_NOT_CONFIGURED_RESIDUAL") target.add("auth_not_configured");
  if (step.classification === "AUTH_CONFIGURED_UNAUTHENTICATED" || step.classification === "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED") {
    target.add("unauthenticated_expected");
  }
  if (step.feed_recheck_classification === "NO_ELIGIBLE_FEED_RECHECK_TARGET") target.add("no_eligible_feed_target");
  if (step.feed_onboarding_classification === "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED") {
    target.add("accepted_route_smoke_pending_effect");
  }
  if (step.feed_onboarding_classification === "FEED_ONBOARDING_ROUTE_SMOKE_ATTENTION_REQUIRED") {
    target.add("backend_route_missing");
  }
}

function rootSummary() {
  return {
    repo: existsSync(path.join(repoRoot, ".git")),
    backend: existsSync(path.join(backendRoot, "package.json")),
    frontend: existsSync(path.join(frontendRoot, "package.json"))
  };
}

function operatorFileSummary() {
  return {
    backend: {
      envProduction: existsSync(path.join(backendRoot, ".env.production")),
      runtimeImageEnv: existsSync(path.join(backendRoot, "deploy", "runtime-image.env")),
      compose: existsSync(path.join(backendRoot, "deploy", "production", "compose.yaml"))
    },
    frontend: {
      envProduction: existsSync(path.join(frontendRoot, ".env.production")),
      compose: existsSync(path.join(frontendRoot, "deploy", "production", "compose.yaml")),
      backendNetworkOverlay: existsSync(path.join(frontendRoot, "deploy", "production", "compose.backend-network.yaml"))
    }
  };
}

function gitSummary() {
  return {
    current: runGit(["rev-parse", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    origin_main: runGit(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/u)[0] || "unavailable"
  };
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

function runNpm(cwd, npmArgs) {
  const invocation = resolveNpm(npmArgs);
  return spawnSync(invocation.executable, invocation.args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 180000
  });
}

function resolveNpm(npmArgs) {
  if (process.env.npm_execpath !== undefined) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...npmArgs] };
  }
  if (process.platform === "win32") {
    const npmCli = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) return { executable: process.execPath, args: [npmCli, ...npmArgs] };
  }
  return { executable: "npm", args: npmArgs };
}

function parseJson(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("--endpoint/OPERATOR_RETEST_BASE_URL must be an absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("--endpoint must use http or https");
  if (parsed.username !== "" || parsed.password !== "") fail("--endpoint must not include userinfo");
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`operator-production-promotion-retest: ${message}\n`);
  process.exit(1);
}
