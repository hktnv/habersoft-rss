import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
      milestone: "MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET",
      retest_script: "ops:production:retest:redacted",
      acceptance_script: "ops:production:acceptance:redacted",
      feed_recheck_eligibility_script: "ops:feed-recheck:eligibility:redacted",
      no_eligible_target_classification: "NO_ELIGIBLE_FEED_RECHECK_TARGET",
      feed_recheck_effect_status: "PENDING_NO_ELIGIBLE_TARGET",
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
    "ops:production:retest:redacted": "node scripts/operator-production-retest.mjs",
    "ops:production:acceptance:redacted": "node scripts/operator-production-retest.mjs --acceptance-only",
    "ops:feed-recheck:eligibility:redacted": "node scripts/operator-production-retest.mjs --acceptance-only --feed-recheck-only",
    "verify:operator-automation": "node scripts/operator-automation-verify.mjs"
  };
  for (const [name, command] of Object.entries(requiredFrontend)) {
    if (frontendScripts[name] !== command) failures.push(`frontend package.json missing ${name}`);
  }
  if (backendScripts["ops:production:recreate:api-worker"] !== "node scripts/production-api-worker-recreate.mjs") {
    failures.push("backend package.json missing ops:production:recreate:api-worker");
  }

  for (const file of [
    "scripts/operator-production-retest.mjs",
    "scripts/operator-automation-verify.mjs",
    "../rss-habersoft-com/scripts/production-api-worker-recreate.mjs"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }

  const ui = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  if (!ui.includes("No recheckable feeds are currently available.")) {
    failures.push("OperationsDrilldown missing no-eligible feed recheck empty state");
  }

  const composeOps = readFrontend("scripts/production-compose-ops.mjs");
  for (const fragment of ["--apply", "apply_required_for_mutation", "mutatingCommand && !apply", "npm run ops:compose:recreate -- --apply"]) {
    if (!composeOps.includes(fragment)) failures.push(`frontend compose helper missing apply guardrail: ${fragment}`);
  }

  const backendRecreate = readBackend("scripts/production-api-worker-recreate.mjs");
  for (const fragment of ["--apply", "backend-api-worker-recreate-dry-run", "backend-api-worker-recreate-apply", "apply_required_for_mutation", "credentials and secrets must not be supplied"]) {
    if (!backendRecreate.includes(fragment)) failures.push(`backend recreate helper missing guardrail: ${fragment}`);
  }

  const operatorRetest = readFrontend("scripts/operator-production-retest.mjs");
  for (const fragment of [
    "OPERATOR_RETEST_DRY_RUN_READY",
    "OPERATOR_ACCEPTANCE_REDACTED_OK",
    "NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_NO_ELIGIBLE_TARGET",
    "FEED_RECHECK_ACTION_ACCEPTED",
    "AUTH_CONFIGURED_UNAUTHENTICATED",
    "AUTHENTICATED_ADMIN_ACCEPTED",
    "AUTH_LOGIN_ATTEMPT_FAILED",
    "ADMIN_API_ROUTE_UNAVAILABLE",
    "FEED_RECHECK_UNAUTH_POST_NOT_401_JSON",
    "--attempt-feed-recheck"
  ]) {
    if (!operatorRetest.includes(fragment)) failures.push(`operator retest script missing classification: ${fragment}`);
  }

  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");
  for (const fragment of [
    "MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "ops:production:retest:redacted",
    "ops:production:acceptance:redacted",
    "ops:feed-recheck:eligibility:redacted",
    "ops:production:recreate:api-worker -- --dry-run",
    "ops:production:recreate:api-worker -- --apply",
    "ops:compose:recreate -- --apply",
    "CRITICAL",
    "HIGH",
    "MEDIUM",
    "LOW"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-026B automation/risk fragment: ${fragment}`);
  }
}

async function assertRuntimeClassifications() {
  let scenario = "no-feeds";
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
    if (noCredentials.json.auth?.classification !== "AUTH_CONFIGURED_UNAUTHENTICATED") {
      failures.push("no-credentials acceptance did not classify configured unauthenticated auth state");
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
    if (noEligible.json.feed_recheck?.effect_status !== "PENDING_NO_ELIGIBLE_TARGET") {
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

    for (const result of [dryRun, noCredentials, noEligible, eligibleAccepted]) {
      assertSanitized(result.stdout);
    }
  } finally {
    await close(server);
  }
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
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/operator-production-retest.mjs", ...args], {
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
