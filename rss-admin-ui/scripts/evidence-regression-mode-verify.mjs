import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const resultCode = "SUCCESS_MS_027B_R2_EVIDENCE_AUTOMATION_REGRESSION_MODE_LANDED_OPERATOR_RETEST_OPTIONAL";
const failures = [];

assertStaticContracts();
await assertRuntimeSemantics();

if (failures.length > 0) {
  for (const failure of failures) console.error(`evidence-regression-mode-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "evidence-regression-mode-verify-ok",
      result: resultCode,
      fresh_initial_acceptance: "FEED_ONBOARDING_EFFECT_ACCEPTED",
      regression_onboarding_continuity: "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
      already_present_classification: "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
      recheck_regression: "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
      first_time_missing_onboarding: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      critical_leakage: "BROWSER_EVIDENCE_INVALID",
      production_contact: false,
      production_mutation: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertStaticContracts() {
  const frontendPackage = JSON.parse(readFrontend("package.json"));
  if (frontendPackage.scripts?.["verify:evidence-regression-mode"] !== "node scripts/evidence-regression-mode-verify.mjs") {
    failures.push("package.json missing verify:evidence-regression-mode");
  }

  for (const file of [
    "scripts/evidence-regression-mode-verify.mjs",
    "scripts/browser-evidence-verify.mjs",
    "scripts/operator-production-retest.mjs",
    "src/adminOperations/browserEvidence.ts",
    "tests/browser-evidence.test.ts",
    ".docs/production-feed-effect-acceptance.md",
    ".docs/operator-risk-model.md",
    "README.md",
    "PRODUCTION.md"
  ]) {
    if (!existsSync(path.resolve(frontendRoot, file))) failures.push(`missing frontend file: ${file}`);
  }

  const browserVerifier = readFrontend("scripts/browser-evidence-verify.mjs");
  for (const fragment of [
    "--regression-mode",
    "--no-prior-acceptance-ledger",
    "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
    "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
    "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
    "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
    "PENDING_INITIAL_ONBOARDING_EFFECT_EVIDENCE"
  ]) {
    if (!browserVerifier.includes(fragment)) failures.push(`browser evidence verifier missing R2 fragment: ${fragment}`);
  }

  const operatorRetest = readFrontend("scripts/operator-production-retest.mjs");
  for (const fragment of [
    "--initial-acceptance",
    "browserEvidenceVerifierArgs",
    "hasPriorMs027bAcceptanceLedger",
    "MS-027B-R2",
    "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK"
  ]) {
    if (!operatorRetest.includes(fragment)) failures.push(`operator retest missing R2 fragment: ${fragment}`);
  }

  const browserEvidence = readFrontend("src/adminOperations/browserEvidence.ts");
  for (const fragment of [
    "already_present",
    "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
    "FEED_ONBOARDING_ACTION_ALREADY_EXISTS"
  ]) {
    if (!browserEvidence.includes(fragment)) failures.push(`browser evidence schema missing R2 fragment: ${fragment}`);
  }

  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-feed-effect-acceptance.md"),
    readFrontend(".docs/operator-risk-model.md"),
    readFrontend(".docs/production-activation-package.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");
  for (const fragment of [
    resultCode,
    "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
    "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
    "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
    "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
    "verify:evidence-regression-mode",
    "MS-027B-R1 feed onboarding plus recheck effect production acceptance remains accepted",
    "Do not claim a fresh onboarding effect from an already-present feed regression retest"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing R2 fragment: ${fragment}`);
  }
  assertNoUnsafeEvidenceSurface(docs);
}

async function assertRuntimeSemantics() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "ms027b-r2-verify-"));
  const nginxConfig = path.join(tempRoot, "default.conf");
  writeFileSync(
    nginxConfig,
    [
      "server {",
      "  location = /admin-api/operations/summary {}",
      "  location = /admin-api/operations/drilldown {}",
      "  location = /admin-api/operations/feed-recheck-requests {}",
      "  location = /admin-api/operations/feed-onboarding-requests {}",
      "  location = /admin-api {}",
      "  location ^~ /admin-api/ {}",
      "  location / {}",
      "}"
    ].join("\n")
  );

  const server = createServer((request, response) => route(request, response));
  const port = await listen(server);
  try {
    await assertBrowserCase("fresh full acceptance", ["scripts/browser-evidence-verify.mjs", "--stdin"], acceptedEffectEvidence(), (parsed, status) => {
      if (status !== 0 || parsed?.status !== "browser-evidence-verify-ok") failures.push("fresh acceptance evidence was not accepted");
      if (!parsed?.classifications?.includes("FEED_ONBOARDING_EFFECT_ACCEPTED")) failures.push("fresh acceptance missing onboarding effect");
      if (!parsed?.classifications?.includes("FEED_RECHECK_EFFECT_ACCEPTED")) failures.push("fresh acceptance missing recheck effect");
    });

    await assertBrowserCase(
      "regression prior ledger",
      ["scripts/browser-evidence-verify.mjs", "--stdin", "--regression-mode"],
      recheckOnlyRegressionEvidence(),
      (parsed, status) => {
        if (status !== 0 || parsed?.status !== "browser-evidence-verify-ok") failures.push("regression prior-ledger evidence was not accepted");
        if (parsed?.classifications?.includes("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON")) failures.push("regression prior-ledger evidence still surfaced onboarding operator action required");
        if (!parsed?.classifications?.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK")) failures.push("regression prior-ledger evidence missing ledger continuity");
        if (!parsed?.classifications?.includes("RECHECK_EFFECT_ACCEPTED_REGRESSION_OK")) failures.push("regression prior-ledger evidence missing recheck regression classification");
      }
    );

    await assertBrowserCase(
      "first-time no prior ledger",
      ["scripts/browser-evidence-verify.mjs", "--stdin", "--regression-mode", "--no-prior-acceptance-ledger"],
      recheckOnlyRegressionEvidence(),
      (parsed, status) => {
        if (status !== 0 || parsed?.status !== "browser-evidence-verify-ok") failures.push("no-ledger evidence should remain valid but semantically pending");
        if (!parsed?.classifications?.includes("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON")) failures.push("no-ledger evidence did not fail closed for onboarding");
        if (parsed?.classifications?.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK")) failures.push("no-ledger evidence incorrectly used ledger continuity");
      }
    );

    await assertBrowserCase("critical leakage", ["scripts/browser-evidence-verify.mjs", "--stdin"], forbiddenEvidence(), (parsed, status) => {
      if (status === 0 || parsed?.classification !== "BROWSER_EVIDENCE_INVALID") failures.push("forbidden evidence was not rejected");
    });

    const routeOnly = await runNode(
      [
        "scripts/operator-production-retest.mjs",
        "--acceptance-only",
        "--endpoint",
        `http://127.0.0.1:${port}`,
        "--nginx-config-file",
        nginxConfig
      ],
      { timeoutMs: 90000 }
    );
    const routeOnlyParsed = parseJson(routeOnly.stdout);
    if (routeOnly.status !== 0 || routeOnlyParsed?.status !== "OPERATOR_ACCEPTANCE_REDACTED_OK") failures.push("route-proof-only acceptance wrapper did not stay non-critical");
    if (!routeOnlyParsed?.classifications?.includes("NGINX_ROUTE_PROOF_ACCEPTED")) failures.push("route-proof-only wrapper did not accept route proof");
    if (routeOnlyParsed?.classifications?.includes("FEED_ONBOARDING_EFFECT_ACCEPTED")) failures.push("route-proof-only wrapper overclaimed onboarding effect");
    if (routeOnlyParsed?.classifications?.includes("FEED_RECHECK_EFFECT_ACCEPTED")) failures.push("route-proof-only wrapper overclaimed recheck effect");

    const operatorRegression = await runNode(
      [
        "scripts/operator-production-retest.mjs",
        "--acceptance-only",
        "--endpoint",
        `http://127.0.0.1:${port}`,
        "--browser-evidence-stdin",
        "--nginx-config-file",
        nginxConfig
      ],
      { input: `${JSON.stringify(recheckOnlyRegressionEvidence(), null, 2)}\n`, timeoutMs: 90000 }
    );
    const operatorRegressionParsed = parseJson(operatorRegression.stdout);
    if (operatorRegression.status !== 0 || operatorRegressionParsed?.status !== "OPERATOR_ACCEPTANCE_REDACTED_OK") failures.push("operator regression wrapper did not accept prior-ledger retest");
    if (!operatorRegressionParsed?.classifications?.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK")) failures.push("operator regression wrapper missing onboarding ledger continuity");
    if (!operatorRegressionParsed?.classifications?.includes("RECHECK_EFFECT_ACCEPTED_REGRESSION_OK")) failures.push("operator regression wrapper missing recheck-only regression classification");
    if (operatorRegressionParsed?.classifications?.includes("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON")) failures.push("operator regression wrapper surfaced false onboarding action required");

    assertSanitized(`${routeOnly.stdout}\n${operatorRegression.stdout}`);
  } finally {
    await close(server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function assertBrowserCase(label, args, evidence, assertFn) {
  const result = await runNode(args, { input: `${JSON.stringify(evidence, null, 2)}\n`, timeoutMs: 30000 });
  const parsed = parseJson(result.stdout);
  assertFn(parsed, result.status);
  assertSanitized(`${label}\n${result.stdout}`);
}

function route(request, response) {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  if (parsed.pathname === "/healthz") return json(response, 200, { status: "ok" });
  if (parsed.pathname === "/status-api/health/live") return json(response, 200, { status: "live" });
  if (parsed.pathname === "/status-api/health/ready") return json(response, 200, { status: "ready" });
  if (parsed.pathname === "/admin-auth/session") return json(response, 200, { configured: true, authenticated: false, reason: "unauthenticated" });
  if (parsed.pathname === "/admin-api/operations/summary" || parsed.pathname === "/admin-api/operations/drilldown") return json(response, 401, { authenticated: false, reason: "unauthenticated" });
  if (parsed.pathname === "/admin-api/operations/feed-recheck-requests") {
    return json(response, request.method === "POST" ? 401 : 405, request.method === "POST" ? { authenticated: false, reason: "unauthenticated" } : { status: "method_not_allowed", reason: "feed_recheck_requires_post" });
  }
  if (parsed.pathname === "/admin-api/operations/feed-onboarding-requests") {
    return json(response, request.method === "POST" ? 401 : 405, request.method === "POST" ? { authenticated: false, reason: "unauthenticated" } : { status: "method_not_allowed", reason: "feed_onboarding_requires_post" });
  }
  if (parsed.pathname.startsWith("/admin-api/")) return json(response, 404, { status: "not_found", reason: "admin_api_route_not_found" });
  return json(response, 404, { status: "not_found" });
}

function acceptedEffectEvidence() {
  return {
    ...baseEvidence(),
    feedRecheck: {
      effectStatus: "FEED_RECHECK_EFFECT_ACCEPTED",
      lastActionClassification: "FEED_RECHECK_ACTION_ACCEPTED"
    },
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "accepted",
      no_eligible_target: false,
      critical_risk: "none",
      effectStatus: "FEED_ONBOARDING_EFFECT_ACCEPTED",
      lastActionClassification: "FEED_ONBOARDING_ACTION_ACCEPTED"
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "FEED_ONBOARDING_EFFECT_ACCEPTED",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
    ]
  };
}

function recheckOnlyRegressionEvidence() {
  return {
    ...baseEvidence(),
    feedRecheck: {
      effectStatus: "FEED_RECHECK_EFFECT_ACCEPTED",
      lastActionClassification: "FEED_RECHECK_ACTION_ALREADY_PENDING"
    },
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "available",
      no_eligible_target: false,
      critical_risk: "none",
      effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      lastActionClassification: null
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
    ]
  };
}

function forbiddenEvidence() {
  return {
    ...baseEvidence(),
    actionRef: "feed_recheck_v1.REDACTED_BUT_FORBIDDEN_IN_BROWSER_EVIDENCE"
  };
}

function baseEvidence() {
  return {
    schema: "habersoft-admin-browser-evidence-v1",
    source: "admin-ui",
    milestone: "MS-027B",
    generatedAt: "2026-07-01T10:00:00.000Z",
    authenticated: true,
    operations: {
      drilldownStatus: "ok",
      drilldownGeneratedAt: "2026-07-01T09:59:00.000Z",
      feeds: {
        total: 1,
        active: 1,
        rows: 1,
        eligibleRecheckTargets: 1,
        noEligibleFeedRecheckTarget: false
      },
      ingestion: {
        rows: 0,
        recentEntryCount: 0,
        recentBatchCount: 0
      }
    },
    feedRecheck: {
      effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      lastActionClassification: null
    },
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "available",
      no_eligible_target: false,
      critical_risk: "none",
      effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      lastActionClassification: null
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
    ]
  };
}

function assertNoUnsafeEvidenceSurface(text) {
  const rawFeedUrl = /https:\/\/[^`\s"]+\/feed\.(?:xml|rss|atom)\b/iu;
  for (const line of text.split(/\r?\n/u)) {
    if (!/feed_recheck_v1\./iu.test(line) && !rawFeedUrl.test(line)) continue;
    if (isSafetyGuidanceLine(line)) continue;
    failures.push(`unsafe evidence surface in docs/output: ${line.trim()}`);
  }
}

function assertSanitized(text) {
  for (const forbidden of [/feed_recheck_v1\./iu, /Set-Cookie|Authorization|Bearer\s+/iu, /https:\/\/[^`\s"]+\/feed\.(?:xml|rss|atom)\b/iu]) {
    if (forbidden.test(text)) failures.push(`automation output leaked forbidden text: ${forbidden}`);
  }
}

function isSafetyGuidanceLine(line) {
  return /\b(no|not|never|without|reject|rejected|redact|redacted|must not|do not|did not|does not|is not|are not|excluded|forbidden|fails closed|fail closed|HttpOnly|SameSite|Secure|opaque|example|template)\b/iu.test(
    line
  );
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) resolve(address.port);
      else reject(new Error("could not bind test server"));
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: frontendRoot,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: null, signal: null, error, stdout, stderr });
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

function parseJson(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
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
