import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const resultCode = "SUCCESS_MS_027B_R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTANCE_CLOSED_OPERATOR_REPORTED_EVIDENCE_AUTOMATION_LANDED";
const acceptedStatus = "MS-027B-R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const receiptPath =
  "operator-state/admin-ui-production-activation/ms-027b-r1-feed-onboarding-recheck-effect-accepted-operator-reported-receipt.json";
const failures = [];

assertStaticContracts();
await assertRuntimeAcceptanceAutomation();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-feed-effect-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-feed-effect-acceptance-verify-ok",
      result: resultCode,
      accepted_status: acceptedStatus,
      evidence_source: "operator_reported",
      feed_onboarding_effect: "FEED_ONBOARDING_EFFECT_ACCEPTED",
      feed_recheck_effect: "FEED_RECHECK_EFFECT_ACCEPTED",
      browser_evidence_verifier: "browser-evidence-verify-ok",
      route_proof: "NGINX_ROUTE_PROOF_ACCEPTED",
      receipt_path: receiptPath,
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
  if (frontendPackage.scripts?.["verify:production-feed-effect-acceptance"] !== "node scripts/production-feed-effect-acceptance-verify.mjs") {
    failures.push("package.json missing verify:production-feed-effect-acceptance");
  }

  for (const file of [
    "scripts/production-feed-effect-acceptance-verify.mjs",
    "scripts/browser-evidence-verify.mjs",
    "scripts/operator-production-retest.mjs",
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/operator-automation-verify.mjs",
    "src/adminOperations/OperationsDrilldown.tsx",
    ".docs/production-feed-effect-acceptance.md",
    ".docs/operator-risk-model.md",
    "README.md",
    "PRODUCTION.md"
  ]) {
    if (!existsSync(path.resolve(frontendRoot, file))) failures.push(`missing frontend file: ${file}`);
  }

  const browserVerifier = readFrontend("scripts/browser-evidence-verify.mjs");
  for (const fragment of ["--stdin", "verifyEvidenceStdin", "stdin_accepted_effect", "output: \"redacted\""]) {
    if (!browserVerifier.includes(fragment)) failures.push(`browser evidence verifier missing ${fragment}`);
  }

  const acceptance = readFrontend("scripts/operator-production-retest.mjs");
  for (const fragment of [
    "--browser-evidence-file",
    "--browser-evidence-stdin",
    "--write-receipt",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "NGINX_ROUTE_PROOF_MISSING_ADMIN_API_ROUTE",
    "NGINX_ROUTE_PROOF_UNRESOLVED_TEMPLATE_MARKER",
    "NGINX_ROUTE_PROOF_CONTAINER_NOT_RUNNING",
    "NGINX_ROUTE_PROOF_UNAVAILABLE",
    "FEED_ONBOARDING_EFFECT_PENDING",
    "FEED_RECHECK_EFFECT_PENDING",
    "UNSAFE_EVIDENCE_REJECTED",
    "criticalRisk"
  ]) {
    if (!acceptance.includes(fragment)) failures.push(`operator acceptance script missing ${fragment}`);
  }

  const promotion = readFrontend("scripts/operator-production-promotion-retest.mjs");
  for (const fragment of ["--browser-evidence-file", "routeProofFromRunningContainer", "NGINX_ROUTE_PROOF_CONTAINER_NOT_RUNNING"]) {
    if (!promotion.includes(fragment)) failures.push(`promotion retest script missing ${fragment}`);
  }

  const drilldown = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  for (const fragment of ["Download redacted evidence JSON", "habersoft-ms027b-redacted-evidence", "Blob", "createObjectURL"]) {
    if (!drilldown.includes(fragment)) failures.push(`browser evidence download bridge missing ${fragment}`);
  }

  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/production-feed-effect-acceptance.md"),
    readFrontend(".docs/operator-risk-model.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/production-feed-onboarding-acceptance.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");

  for (const fragment of [
    resultCode,
    acceptedStatus,
    "operator_reported",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "browser-evidence-verify-ok",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET is closed for the bounded MS-027B feed onboarding plus recheck effect scope",
    "Codex did not independently perform a credentialed production login",
    "no production contact by Codex",
    "no production mutation by Codex",
    receiptPath,
    "ops:production:acceptance:redacted -- --browser-evidence-stdin",
    "Download redacted evidence JSON",
    "verify:production-feed-effect-acceptance"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing R1 fragment: ${fragment}`);
  }

  assertNoUnsafeEvidenceSurface(docs);
}

async function assertRuntimeAcceptanceAutomation() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "ms027b-r1-verify-"));
  const nginxConfig = path.join(tempRoot, "default.conf");
  const receipt = path.join(tempRoot, "receipt.json");
  const evidence = `${JSON.stringify(acceptedBrowserEvidence(), null, 2)}\n`;
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

  const server = createServer((request, response) => {
    route(request, response);
  });
  const port = await listen(server);
  try {
    const result = await runNode(
      [
        "scripts/operator-production-retest.mjs",
        "--acceptance-only",
        "--endpoint",
        `http://127.0.0.1:${port}`,
        "--browser-evidence-stdin",
        "--nginx-config-file",
        nginxConfig,
        "--write-receipt",
        receipt
      ],
      { input: evidence, timeoutMs: 90000 }
    );
    const parsed = parseJson(result.stdout);
    if (result.status !== 0 || parsed?.status !== "OPERATOR_ACCEPTANCE_REDACTED_OK") {
      failures.push(
        `stdin acceptance automation failed: ${result.status} ${result.signal ?? ""} ${result.error?.message ?? ""} ${result.stderr} ${JSON.stringify({
          status: parsed?.status,
          criticalRisk: parsed?.criticalRisk,
          classifications: parsed?.classifications,
          routeCritical: parsed?.route_classifications?.critical
        })}`
      );
    }
    if (!parsed?.classifications?.includes("FEED_ONBOARDING_EFFECT_ACCEPTED")) {
      failures.push("stdin acceptance did not classify feed onboarding effect accepted");
    }
    if (!parsed?.classifications?.includes("FEED_RECHECK_EFFECT_ACCEPTED")) {
      failures.push("stdin acceptance did not classify feed recheck effect accepted");
    }
    if (!parsed?.classifications?.includes("NGINX_ROUTE_PROOF_ACCEPTED")) {
      failures.push("stdin acceptance did not classify route proof accepted");
    }
    if (parsed?.criticalRisk !== "none") failures.push("stdin acceptance did not report criticalRisk none");
    if (!existsSync(receipt)) failures.push("stdin acceptance did not write a redacted receipt");
    const receiptText = existsSync(receipt) ? readFileSync(receipt, "utf8") : "";
    const receiptJson = parseJson(receiptText);
    if (!/^[a-f0-9]{64}$/u.test(receiptJson?.receipt_sha256 ?? "")) failures.push("receipt missing sha256");

    const browser = await runNode(["scripts/browser-evidence-verify.mjs", "--stdin"], { input: evidence, timeoutMs: 30000 });
    const browserParsed = parseJson(browser.stdout);
    if (browser.status !== 0 || browserParsed?.status !== "browser-evidence-verify-ok") {
      failures.push("browser evidence verifier stdin mode failed");
    }
    assertSanitized(`${result.stdout}\n${browser.stdout}\n${receiptText}`);
  } finally {
    await close(server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function route(request, response) {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  if (parsed.pathname === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok\n");
    return;
  }
  if (parsed.pathname === "/status-api/health/live") {
    json(response, 200, { status: "live" });
    return;
  }
  if (parsed.pathname === "/status-api/health/ready") {
    json(response, 200, { status: "ready", dependencies: { postgres: "up", redis: "up", tenantAuth: "up" } });
    return;
  }
  if (parsed.pathname === "/admin-auth/session") {
    json(response, 200, { configured: true, authenticated: false, reason: "unauthenticated" });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/summary" || parsed.pathname === "/admin-api/operations/drilldown") {
    json(response, 401, { authenticated: false, reason: "unauthenticated" });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/feed-recheck-requests") {
    json(response, request.method === "POST" ? 401 : 405, request.method === "POST" ? { authenticated: false, reason: "unauthenticated" } : { status: "method_not_allowed", reason: "feed_recheck_requires_post" });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/feed-onboarding-requests") {
    json(response, request.method === "POST" ? 401 : 405, request.method === "POST" ? { authenticated: false, reason: "unauthenticated" } : { status: "method_not_allowed", reason: "feed_onboarding_requires_post" });
    return;
  }
  if (parsed.pathname.startsWith("/admin-api/")) {
    json(response, 404, { status: "not_found", reason: "admin_api_route_not_found" });
    return;
  }
  json(response, 404, { status: "not_found" });
}

function acceptedBrowserEvidence() {
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

function assertNoUnsafeEvidenceSurface(text) {
  const rawFeedUrl = /https:\/\/[^`\s"]+\/feed\.(?:xml|rss|atom)\b/iu;
  for (const line of text.split(/\r?\n/u)) {
    if (!/feed_recheck_v1\.|https:\/\//iu.test(line)) continue;
    if (isSafetyGuidanceLine(line)) continue;
    if (/feed_recheck_v1\./iu.test(line) || rawFeedUrl.test(line)) {
      failures.push(`unsafe evidence surface in docs: ${line.trim()}`);
    }
  }

  const secretLikeStatement =
    /\b(?:cookie|session id|csrf token|idempotency key|actionRef|raw feed URL|raw logs|raw response bodies)\b[^\n]{0,80}\b(?:is|are|include|required|stored)\b/iu;
  for (const line of text.split(/\r?\n/u)) {
    if (!secretLikeStatement.test(line)) continue;
    if (isSafetyGuidanceLine(line)) continue;
    failures.push(`unsafe evidence surface in docs: ${line.trim()}`);
  }
}

function isSafetyGuidanceLine(line) {
  return /\b(no|not|never|without|reject|rejected|redact|redacted|must not|do not|did not|does not|is not|are not|excluded|forbidden|fails closed|fail closed|HttpOnly|SameSite|Secure|opaque|example|template)\b/iu.test(
    line
  );
}

function assertSanitized(text) {
  for (const forbidden of [
    /feed_recheck_v1\./iu,
    /https:\/\/onboarding\.example\.org\/feed\.xml/iu,
    /habersoft_admin_session=/iu,
    /csrf_token_value/iu,
    /Set-Cookie|Authorization|Bearer\s+/iu
  ]) {
    if (forbidden.test(text)) failures.push(`automation output leaked forbidden text: ${forbidden}`);
  }
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
