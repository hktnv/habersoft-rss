import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

assertStaticContracts();
await assertRuntimeClassifications();

if (failures.length > 0) {
  for (const failure of failures) console.error(`operator-automation-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "operator-automation-verify-ok",
      milestone: "MS-026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW",
      retest_script: "ops:production:retest",
      low_level_retest_script: "ops:production:retest:redacted",
      acceptance_script: "ops:production:acceptance:redacted",
      feed_recheck_eligibility_script: "ops:feed-recheck:eligibility:redacted",
      browser_evidence_script: "ops:browser-evidence:verify",
      feed_onboarding_recheck_effect_flow_script: "verify:feed-onboarding-recheck-effect-flow",
      feed_onboarding_recheck_effect_acceptance_script: "verify:production-feed-effect-acceptance",
      no_eligible_target_classification: "NO_ELIGIBLE_FEED_RECHECK_TARGET",
      feed_recheck_effect_status: "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
      feed_onboarding_route_smoke: "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
      production_contact: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertStaticContracts() {
  const frontendPackage = JSON.parse(readFrontend("package.json"));
  const backendPackage = JSON.parse(readBackend("package.json"));
  const frontendScripts = frontendPackage.scripts ?? {};
  const backendScripts = backendPackage.scripts ?? {};
  const requiredFrontend = {
    "ops:production:retest": "node scripts/operator-production-promotion-retest.mjs",
    "ops:production:promote-retest:redacted": "node scripts/operator-production-promotion-retest.mjs",
    "ops:production:retest:redacted": "node scripts/operator-production-retest.mjs",
    "ops:production:acceptance:redacted": "node scripts/operator-production-retest.mjs --acceptance-only",
    "ops:feed-recheck:eligibility:redacted": "node scripts/operator-production-retest.mjs --acceptance-only --feed-recheck-only",
    "ops:browser-evidence:verify": "node scripts/browser-evidence-verify.mjs",
    "verify:browser-evidence": "node scripts/browser-evidence-verify.mjs --self-test",
    "verify:admin-feed-onboarding": "node scripts/admin-feed-onboarding-verify.mjs",
    "verify:feed-onboarding-recheck-effect-flow": "node scripts/feed-onboarding-recheck-effect-flow-verify.mjs",
    "verify:operator-automation": "node scripts/operator-automation-verify.mjs",
    "verify:production-image-freshness": "node scripts/production-image-freshness-verify.mjs",
    "verify:production-feed-onboarding-acceptance": "node scripts/production-feed-onboarding-acceptance-verify.mjs",
    "verify:production-feed-effect-acceptance": "node scripts/production-feed-effect-acceptance-verify.mjs"
  };
  for (const [name, command] of Object.entries(requiredFrontend)) {
    if (frontendScripts[name] !== command) failures.push(`frontend package.json missing ${name}`);
  }
  if (backendScripts["ops:production:recreate:api-worker"] !== "node scripts/production-api-worker-recreate.mjs") {
    failures.push("backend package.json missing ops:production:recreate:api-worker");
  }

  for (const file of [
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/operator-production-retest.mjs",
    "scripts/operator-automation-verify.mjs",
    "scripts/admin-feed-onboarding-verify.mjs",
    "scripts/browser-evidence-verify.mjs",
    "scripts/feed-onboarding-recheck-effect-flow-verify.mjs",
    "scripts/operator-risk-model.mjs",
    "scripts/production-image-freshness-verify.mjs",
    "scripts/production-feed-onboarding-acceptance-verify.mjs",
    "scripts/production-feed-effect-acceptance-verify.mjs",
    "src/adminOperations/browserEvidence.ts",
    ".docs/production-feed-onboarding-acceptance.md",
    ".docs/production-feed-effect-acceptance.md",
    "../rss-habersoft-com/scripts/production-api-worker-recreate.mjs"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }

  const ui = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  if (!ui.includes("No eligible feed recheck target is currently available.") || !ui.includes("Copy redacted evidence")) {
    failures.push("OperationsDrilldown missing no-eligible feed recheck empty state");
  }

  const composeOps = readFrontend("scripts/production-compose-ops.mjs");
  for (const fragment of ["--apply", "apply_required_for_mutation", "mutatingCommand && !apply", "npm run ops:compose:recreate -- --apply", "frontend_image_stale", "build_current_head_then_recreate", "--recreate-only"]) {
    if (!composeOps.includes(fragment)) failures.push(`frontend compose helper missing apply guardrail: ${fragment}`);
  }

  const backendRecreate = readBackend("scripts/production-api-worker-recreate.mjs");
  for (const fragment of ["--apply", "backend-api-worker-recreate-dry-run", "backend-api-worker-recreate-apply", "apply_required_for_mutation", "credentials and secrets must not be supplied", "backend_image_stale", "source_not_promoted", "build_current_head_then_recreate", "--recreate-only"]) {
    if (!backendRecreate.includes(fragment)) failures.push(`backend recreate helper missing guardrail: ${fragment}`);
  }

  const operatorRetest = readFrontend("scripts/operator-production-retest.mjs");
  for (const fragment of [
    "OPERATOR_RETEST_DRY_RUN_READY",
    "OPERATOR_ACCEPTANCE_REDACTED_OK",
    "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED",
    "NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "FEED_RECHECK_ACTION_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_ONBOARDING_EFFECT_PENDING",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_RECHECK_EFFECT_PENDING",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "NGINX_ROUTE_PROOF_CONTAINER_NOT_RUNNING",
    "UNSAFE_EVIDENCE_REJECTED",
    "AUTHENTICATED_BROWSER_EVIDENCE_ACCEPTED",
    "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
    "FEED_ONBOARDING_ROUTE_SMOKE_ATTENTION_REQUIRED",
    "FEED_ONBOARDING_UNAUTH_POST_NOT_401_JSON",
    "FEED_ONBOARDING_GET_NOT_405_JSON",
    "AUTH_CONFIGURED_UNAUTHENTICATED",
    "AUTHENTICATED_ADMIN_ACCEPTED",
    "AUTH_LOGIN_ATTEMPT_FAILED",
    "ADMIN_API_ROUTE_UNAVAILABLE",
    "FEED_RECHECK_UNAUTH_POST_NOT_401_JSON",
    "feed_onboarding_status",
    "--attempt-feed-recheck",
    "--browser-evidence",
    "--browser-evidence-file",
    "--browser-evidence-stdin",
    "--write-receipt"
  ]) {
    if (!operatorRetest.includes(fragment)) failures.push(`operator retest script missing classification: ${fragment}`);
  }

  const promotion = readFrontend("scripts/operator-production-promotion-retest.mjs");
  for (const fragment of [
    "OPERATOR_PROMOTION_RETEST_DRY_RUN_READY",
    "OPERATOR_PROMOTION_RETEST_REDACTED_OK",
    "OPERATOR_PROMOTION_RETEST_ATTENTION_REQUIRED",
    "--apply",
    "--retest-only",
    "--nginx-config-file",
    "--browser-evidence",
    "--browser-evidence-file",
    "routeProofFromRunningContainer",
    "NGINX_ROUTE_PROOF_CONTAINER_NOT_RUNNING",
    "ROUTE_PROOF_NOT_AVAILABLE",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "/admin-api/operations/feed-onboarding-requests",
    "source_not_promoted",
    "backend_image_stale",
    "frontend_image_stale",
    "backend_route_missing",
    "frontend_route_missing",
    "nginx_template_marker_unresolved",
    "auth_not_configured",
    "unauthenticated_expected",
    "no_eligible_feed_target",
    "accepted_route_smoke_pending_effect",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "NGINX_ROUTE_PROOF_MISSING_ADMIN_API_ROUTE",
    "NGINX_ROUTE_PROOF_UNRESOLVED_TEMPLATE_MARKER"
  ]) {
    if (!promotion.includes(fragment)) failures.push(`promotion retest script missing fragment: ${fragment}`);
  }

  const browserEvidence = readFrontend("scripts/browser-evidence-verify.mjs");
  for (const fragment of [
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
    "BROWSER_EVIDENCE_INVALID",
    "--stdin",
    "--self-test"
  ]) {
    if (!browserEvidence.includes(fragment)) failures.push(`browser evidence verifier missing fragment: ${fragment}`);
  }

  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/production-feed-effect-acceptance.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");
  for (const fragment of [
    "MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET",
    "SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED",
    "SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED",
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
    "ops:production:retest",
    "ops:production:retest:redacted",
    "ops:production:acceptance:redacted",
    "ops:feed-recheck:eligibility:redacted",
    "ops:browser-evidence:verify",
    "verify:browser-evidence",
    "verify:admin-feed-onboarding",
    "verify:production-image-freshness",
    "verify:production-feed-onboarding-acceptance",
    "verify:production-feed-effect-acceptance",
    "ops:production:recreate:api-worker -- --dry-run",
    "ops:production:recreate:api-worker -- --apply",
    "--recreate-only",
    "backend_image_stale",
    "frontend_image_stale",
    "ops:compose:recreate -- --apply",
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW",
    "SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED",
    "SUCCESS_MS_027B_FEED_ONBOARDING_RECHECK_EFFECT_FLOW_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED",
    "SUCCESS_MS_027B_R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTANCE_CLOSED_OPERATOR_REPORTED_EVIDENCE_AUTOMATION_LANDED",
    "MS-027B-R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTED_OPERATOR_REPORTED",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_PENDING",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "ops:production:acceptance:redacted -- --browser-evidence-stdin",
    "Download redacted evidence JSON",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "verify:feed-onboarding-recheck-effect-flow"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-027B automation/risk fragment: ${fragment}`);
  }
}

async function assertRuntimeClassifications() {
  let scenario = "no-feeds";
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "operator-automation-verify-"));
  const nginxConfig = path.join(tempRoot, "default.conf");
  const browserEvidenceFile = path.join(tempRoot, "accepted-browser-evidence.json");
  writeFileSync(
    nginxConfig,
    [
      "location = /admin-api/operations/summary {}",
      "location = /admin-api/operations/drilldown {}",
      "location = /admin-api/operations/feed-recheck-requests {}",
      "location = /admin-api/operations/feed-onboarding-requests {}"
    ].join("\n")
  );
  writeFileSync(browserEvidenceFile, `${JSON.stringify(acceptedBrowserEvidence(), null, 2)}\n`);
  const server = createServer(async (request, response) => {
    await handleRequest(request, response, () => scenario);
  });
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const dryRun = await runRetest(["--dry-run", "--endpoint", endpoint]);
    assertJson(dryRun, "OPERATOR_RETEST_DRY_RUN_READY", "dry-run");

    const noCredentials = await runRetest(["--acceptance-only", "--endpoint", endpoint]);
    assertJson(noCredentials, "OPERATOR_ACCEPTANCE_REDACTED_OK", "no-credentials acceptance");
    if (noCredentials.json.auth?.classification !== "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED") {
      failures.push("no-credentials acceptance did not classify authenticated browser evidence required");
    }
    if (noCredentials.json.feed_onboarding?.classification !== "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED") {
      failures.push("no-credentials acceptance did not classify FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED");
    }

    const browserEvidenceAcceptance = await runRetest(["--acceptance-only", "--endpoint", endpoint, "--browser-evidence", browserEvidenceFile]);
    assertJson(browserEvidenceAcceptance, "OPERATOR_ACCEPTANCE_REDACTED_OK", "browser evidence acceptance");
    if (browserEvidenceAcceptance.json.auth?.classification !== "AUTHENTICATED_BROWSER_EVIDENCE_ACCEPTED") {
      failures.push("browser evidence acceptance did not classify authenticated browser evidence accepted");
    }
    if (browserEvidenceAcceptance.json.feed_recheck?.effect_status !== "FEED_RECHECK_EFFECT_ACCEPTED") {
      failures.push("browser evidence acceptance did not preserve feed recheck effect status");
    }
    if (browserEvidenceAcceptance.json.feed_onboarding?.effect_status !== "FEED_ONBOARDING_EFFECT_ACCEPTED") {
      failures.push("browser evidence acceptance did not preserve feed onboarding effect status");
    }

    scenario = "no-feeds";
    const noEligible = await runRetest(["--acceptance-only", "--endpoint", endpoint], {
      ADMIN_AUTH_SMOKE_USERNAME: "operator",
      ADMIN_AUTH_SMOKE_PASSWORD: "operator-password"
    });
    assertJson(noEligible, "OPERATOR_ACCEPTANCE_REDACTED_OK", "no eligible acceptance");
    if (noEligible.json.feed_recheck?.classification !== "NO_ELIGIBLE_FEED_RECHECK_TARGET") {
      failures.push("no eligible acceptance did not classify NO_ELIGIBLE_FEED_RECHECK_TARGET");
    }
    if (noEligible.json.feed_recheck?.effect_status !== "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET") {
      failures.push("no eligible acceptance did not preserve pending effect status");
    }

    scenario = "eligible";
    const eligibleAccepted = await runRetest(["--acceptance-only", "--feed-recheck-only", "--attempt-feed-recheck", "--endpoint", endpoint], {
      ADMIN_AUTH_SMOKE_USERNAME: "operator",
      ADMIN_AUTH_SMOKE_PASSWORD: "operator-password"
    });
    assertJson(eligibleAccepted, "OPERATOR_ACCEPTANCE_REDACTED_OK", "eligible action acceptance");
    if (eligibleAccepted.json.feed_recheck?.classification !== "FEED_RECHECK_ACTION_ACCEPTED") {
      failures.push("eligible action acceptance did not classify FEED_RECHECK_ACTION_ACCEPTED");
    }

    const browserEvidence = await runNode(["scripts/browser-evidence-verify.mjs", "--self-test"]);
    assertJson(browserEvidence, "browser-evidence-verify-self-test-ok", "browser evidence self-test");

    const imageFreshness = await runNode(["scripts/production-image-freshness-verify.mjs"]);
    assertJson(imageFreshness, "production-image-freshness-verify-ok", "production image freshness verifier");

    const feedOnboardingAcceptance = await runNode(["scripts/production-feed-onboarding-acceptance-verify.mjs"]);
    assertJson(
      feedOnboardingAcceptance,
      "production-feed-onboarding-acceptance-verify-ok",
      "production feed onboarding acceptance verifier"
    );

    const feedEffectAcceptance = await runNode(["scripts/production-feed-effect-acceptance-verify.mjs"]);
    assertJson(
      feedEffectAcceptance,
      "production-feed-effect-acceptance-verify-ok",
      "production feed effect acceptance verifier"
    );

    const promotionDryRun = await runPromotion(["--dry-run", "--endpoint", endpoint, "--nginx-config-file", nginxConfig]);
    assertJson(promotionDryRun, "OPERATOR_PROMOTION_RETEST_DRY_RUN_READY", "promotion dry-run");

    const promotionRetest = await runPromotion(["--retest-only", "--endpoint", endpoint, "--nginx-config-file", nginxConfig]);
    assertJson(promotionRetest, "OPERATOR_PROMOTION_RETEST_REDACTED_OK", "promotion retest-only");

    for (const result of [
      dryRun,
      noCredentials,
      browserEvidenceAcceptance,
      noEligible,
      eligibleAccepted,
      browserEvidence,
      imageFreshness,
      feedOnboardingAcceptance,
      feedEffectAcceptance,
      promotionDryRun,
      promotionRetest
    ]) {
      assertSanitized(result.stdout);
    }
  } finally {
    await close(server);
    rmSync(tempRoot, { recursive: true, force: true });
  }
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

async function handleRequest(request, response, scenarioProvider) {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const cookie = request.headers.cookie ?? "";
  const authenticated = /(?:^|;\s*)habersoft_admin_session=valid(?:;|$)/u.test(cookie);

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
    json(response, 200, authenticated
      ? { configured: true, authenticated: true, principal: { kind: "single_admin", displayName: "Admin" }, expiresAt: "2026-07-01T10:00:00.000Z", csrfToken: "csrf_token_value_at_least_32_characters" }
      : { configured: true, authenticated: false, reason: "unauthenticated" });
    return;
  }
  if (parsed.pathname === "/admin-auth/login") {
    response.setHeader("Set-Cookie", "habersoft_admin_session=valid; HttpOnly; Path=/; SameSite=Lax");
    json(response, 200, { configured: true, authenticated: true, csrfToken: "csrf_token_value_at_least_32_characters" });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/summary") {
    if (!authenticated) {
      json(response, 401, { authenticated: false, reason: "unauthenticated" });
      return;
    }
    json(response, 200, {
      status: "ok",
      generatedAt: "2026-07-01T10:00:00.000Z",
      window: { recentHours: 24 },
      dependencies: { postgres: "up", redis: "up", tenantAuth: "up" },
      feeds: { total: scenarioProvider() === "eligible" ? 1 : 0, active: scenarioProvider() === "eligible" ? 1 : 0, disabled: 0, dueNow: 0 },
      entries: { total: 0, createdLast24h: 0 },
      ingestion: { checksLast24h: 0, successLast24h: 0, failedLast24h: 0, latestCheckAt: null },
      notes: []
    });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/drilldown") {
    if (!authenticated) {
      json(response, 401, { authenticated: false, reason: "unauthenticated" });
      return;
    }
    json(response, 200, drilldownBody(scenarioProvider()));
    return;
  }
  if (parsed.pathname === "/admin-api/operations/feed-recheck-requests") {
    if (request.method !== "POST") {
      json(response, 405, { status: "method_not_allowed", reason: "feed_recheck_requires_post" });
      return;
    }
    if (!authenticated) {
      json(response, 401, { authenticated: false, reason: "unauthenticated" });
      return;
    }
    if (request.headers["x-admin-csrf"] === undefined) {
      json(response, 403, { authenticated: true, reason: "csrf_failed" });
      return;
    }
    json(response, 202, {
      status: "accepted",
      requestId: "recheck_abc123def456",
      target: { displayId: "feed_123456abcd", sourceHost: "news.example.org" },
      queued: true,
      cooldownSeconds: 300,
      message: "Feed recheck was requested through the existing due-feed path.",
      generatedAt: "2026-07-01T10:01:00.000Z"
    });
    return;
  }
  if (parsed.pathname === "/admin-api/operations/feed-onboarding-requests") {
    if (request.method !== "POST") {
      json(response, 405, { status: "method_not_allowed", reason: "feed_onboarding_requires_post" });
      return;
    }
    if (!authenticated) {
      json(response, 401, { authenticated: false, reason: "unauthenticated" });
      return;
    }
    if (request.headers["x-admin-csrf"] === undefined) {
      json(response, 403, { authenticated: true, reason: "csrf_failed" });
      return;
    }
    json(response, 201, {
      status: "created",
      requestRef: "onboard_abc123def456",
      feed: {
        displayId: "feed_123456abcd",
        sourceHost: "onboarding.example.org",
        state: "active",
        eligibleForRecheck: true
      },
      nextSteps: ["Refresh Operations Drilldown after deployment."],
      message: "Feed onboarding was accepted through the existing due-feed path.",
      generatedAt: "2026-07-01T10:01:00.000Z"
    });
    return;
  }
  if (parsed.pathname.startsWith("/admin-api/")) {
    json(response, 404, { status: "not_found", reason: "admin_api_route_not_found" });
    return;
  }
  json(response, 404, { status: "not_found" });
}

function drilldownBody(scenario) {
  const eligible = scenario === "eligible";
  return {
    status: "ok",
    generatedAt: "2026-07-01T10:00:00.000Z",
    window: { recentHours: 24, maxRows: 20 },
    feeds: {
      status: "ok",
      total: eligible ? 1 : 0,
      active: eligible ? 1 : 0,
      due: 0,
      withRecentSuccess: eligible ? 1 : 0,
      withRecentFailure: 0,
      rows: eligible
        ? [{
            displayId: "feed_123456abcd",
            displayName: "Example News",
            sourceHost: "news.example.org",
            health: "healthy",
            lastCheckedAt: "2026-07-01T09:55:00.000Z",
            lastResult: "success",
            recentEntryCount: 1,
            notes: [],
            canRequestRecheck: true,
            recheckUnavailableReason: null,
            actionRef: `feed_recheck_v1.${"A".repeat(64)}`
          }]
        : []
    },
    ingestion: {
      status: "ok",
      recentEntryCount: 0,
      recentBatchCount: 0,
      latestEntryAt: null,
      rows: []
    },
    notes: [],
    capabilities: { feedRows: true, ingestionRows: true, reason: null }
  };
}

function runRetest(args, env = {}) {
  return runNode(["scripts/operator-production-retest.mjs", ...args], env);
}

function runPromotion(args, env = {}) {
  return runNode(["scripts/operator-production-promotion-retest.mjs", ...args], env);
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: frontendRoot,
      env: { ...process.env, ...env },
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (status) => {
      let jsonBody;
      try {
        jsonBody = JSON.parse(stdout);
      } catch {
        jsonBody = undefined;
      }
      resolve({ status, stdout, stderr, json: jsonBody });
    });
  });
}

function assertJson(result, expectedStatus, label) {
  if (result.status !== 0) failures.push(`${label} exited ${result.status}: ${result.stderr}`);
  if (result.json?.status !== expectedStatus) {
    failures.push(`${label} returned ${result.json?.status ?? "unparseable"}, expected ${expectedStatus}`);
  }
}

function assertSanitized(text) {
  for (const forbidden of [
    /operator-password/iu,
    /habersoft_admin_session=valid/iu,
    /csrf_token_value_at_least_32_characters/iu,
    /feed_recheck_v1\./iu,
    /https:\/\/onboarding\.example\.org\/feed\.xml/iu,
    /Set-Cookie/iu,
    /Authorization/iu,
    /raw response/iu
  ]) {
    if (forbidden.test(text)) failures.push(`operator retest output leaked forbidden text: ${forbidden}`);
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

function requireFile(file, label) {
  if (!existsSync(file)) failures.push(`missing required file: ${label}`);
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
