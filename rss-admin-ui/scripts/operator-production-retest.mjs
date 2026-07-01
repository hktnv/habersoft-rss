import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const args = process.argv.slice(2);
const acceptanceOnly = args.includes("--acceptance-only");
const feedRecheckOnly = args.includes("--feed-recheck-only");
const attemptFeedRecheck = args.includes("--attempt-feed-recheck");
const dryRun = args.includes("--dry-run") || !acceptanceOnly;
const receiptFile = optionValue("--receipt-file") ?? process.env.OPERATOR_RETEST_RECEIPT_FILE;
const endpoint = optionValue("--endpoint") ?? optionValue("--base-url") ?? process.env.OPERATOR_RETEST_BASE_URL ?? "http://127.0.0.1:8081";
const browserEvidenceFile = optionValue("--browser-evidence") ?? process.env.OPERATOR_BROWSER_EVIDENCE_FILE;
const timeoutMs = Number(process.env.OPERATOR_RETEST_TIMEOUT_MS ?? "5000");
const username = process.env.ADMIN_AUTH_SMOKE_USERNAME;
const password = process.env.ADMIN_AUTH_SMOKE_PASSWORD;
const credentialsProvided = username !== undefined || password !== undefined;

if (args.includes("--help") || args.includes("-h")) {
  writeJson({
    status: "operator-production-retest-help",
    usage: "node scripts/operator-production-retest.mjs [--dry-run|--acceptance-only] [--feed-recheck-only] [--attempt-feed-recheck] [--endpoint URL] [--browser-evidence FILE] [--receipt-file PATH]",
    default: "dry-run diagnostics",
    credential_policy: "admin credentials must be supplied only through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD",
    browser_evidence_policy: "redacted browser evidence can close authenticated read-only and effect classifications without credentials",
    action_policy: "feed recheck action attempt requires --attempt-feed-recheck and an authenticated eligible actionRef; feed onboarding is route-smoked unless redacted evidence reports an effect",
    output: "redacted"
  });
  process.exit(0);
}

if (args.some((arg) => /^--(?:username|password|cookie|csrf|token|idempotency|actionRef|action-ref|secret|authorization|bearer|feedUrl|feed-url)(?:=|$)/iu.test(arg))) {
  fail("credentials, cookies, CSRF tokens, idempotency keys, actionRefs, feed URLs, and secrets must not be supplied on command lines");
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
  fail("OPERATOR_RETEST_TIMEOUT_MS must be an integer between 1000 and 30000");
}
if (credentialsProvided && (username === undefined || username === "" || password === undefined || password === "")) {
  fail("authenticated acceptance requires both ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD");
}

const baseUrl = normalizeBaseUrl(endpoint);

if (dryRun) {
  await finish({
    status: "OPERATOR_RETEST_DRY_RUN_READY",
    mode: "dry-run",
    git: gitSummary(),
    repository_update_preflight: repositoryUpdatePreflight(),
    backend: backendReadinessSummary(),
    frontend: frontendReadinessSummary(),
    acceptance: {
      performed: false,
      command: "npm run ops:production:acceptance:redacted -- --endpoint <panel-origin>",
      feed_recheck_action_attempt_requires: "--attempt-feed-recheck",
      feed_onboarding_action_attempt: "manual authenticated operator action only; not automatic",
      browser_evidence: browserEvidenceFile === undefined ? "optional" : "will_verify"
    },
    risk_tier: riskTierSummary(),
    output: "redacted"
  });
  process.exit(0);
}

await runAcceptance();

async function runAcceptance() {
  const checks = [];
  const healthz = await requestText("GET", "/healthz");
  checks.push(summarize("GET /healthz", healthz));
  const live = feedRecheckOnly ? skipped("GET /status-api/health/live") : await requestJson("GET", "/status-api/health/live");
  const ready = feedRecheckOnly ? skipped("GET /status-api/health/ready") : await requestJson("GET", "/status-api/health/ready");
  if (!feedRecheckOnly) {
    checks.push(summarize("GET /status-api/health/live", live));
    checks.push(summarize("GET /status-api/health/ready", ready));
  }

  const firstSession = await requestJson("GET", "/admin-auth/session");
  checks.push(summarize("GET /admin-auth/session", firstSession));
  const unauthSummary = feedRecheckOnly ? skipped("GET /admin-api/operations/summary unauthenticated") : await requestJson("GET", "/admin-api/operations/summary");
  const unauthDrilldown = await requestJson("GET", "/admin-api/operations/drilldown");
  const unauthFeedRecheck = await requestJson("POST", "/admin-api/operations/feed-recheck-requests", {
    "content-type": "application/json"
  }, JSON.stringify({ actionRef: syntheticActionRef(), reason: "operator_request" }));
  const getFeedRecheck = await requestJson("GET", "/admin-api/operations/feed-recheck-requests");
  const unauthFeedOnboarding = await requestJson("POST", "/admin-api/operations/feed-onboarding-requests", {
    "content-type": "application/json"
  }, syntheticFeedOnboardingBody());
  const getFeedOnboarding = await requestJson("GET", "/admin-api/operations/feed-onboarding-requests");
  const unknownAdminApi = await requestJson("GET", "/admin-api/foo");

  if (!feedRecheckOnly) checks.push(summarize("GET /admin-api/operations/summary unauthenticated", unauthSummary));
  checks.push(summarize("GET /admin-api/operations/drilldown unauthenticated", unauthDrilldown));
  checks.push(summarize("POST /admin-api/operations/feed-recheck-requests unauthenticated", unauthFeedRecheck));
  checks.push(summarize("GET /admin-api/operations/feed-recheck-requests", getFeedRecheck));
  checks.push(summarize("POST /admin-api/operations/feed-onboarding-requests unauthenticated", unauthFeedOnboarding));
  checks.push(summarize("GET /admin-api/operations/feed-onboarding-requests", getFeedOnboarding));
  checks.push(summarize("GET /admin-api/foo", unknownAdminApi));

  const browserEvidence = browserEvidenceFile === undefined
    ? {
        status: "BROWSER_EVIDENCE_NOT_PROVIDED",
        classifications: [],
        feed_recheck_effect_status: "PENDING_BROWSER_EVIDENCE_OR_ENV_CREDENTIALS",
        feed_onboarding_effect_status: "PENDING_BROWSER_EVIDENCE_OR_ENV_CREDENTIALS",
        output: "redacted"
      }
    : runBrowserEvidenceVerifier(browserEvidenceFile);
  const browserEvidenceAccepted = browserEvidence.status === "browser-evidence-verify-ok";
  let auth = {
    credentials: credentialsProvided ? "environment" : "not_provided",
    login_attempted: false,
    session_classification: classifySession(firstSession),
    classification: credentialsProvided
      ? classifySession(firstSession)
      : browserEvidenceAccepted
        ? "AUTHENTICATED_BROWSER_EVIDENCE_ACCEPTED"
        : "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED"
  };
  let feedRecheck = {
    ...(browserEvidenceAccepted
      ? feedRecheckFromBrowserEvidence(browserEvidence)
      : {
          classification: credentialsProvided ? "AUTHENTICATED_DRILLDOWN_NOT_RUN" : "AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED",
          effect_status: credentialsProvided ? "PENDING_AUTHENTICATED_ELIGIBILITY_CHECK" : "PENDING_BROWSER_EVIDENCE_OR_ENV_CREDENTIALS",
          action_attempted: false
        })
  };
  let feedOnboarding = classifyFeedOnboardingRouteSmoke({ unauthFeedOnboarding, getFeedOnboarding });
  if (browserEvidenceAccepted) {
    feedOnboarding = {
      ...feedOnboarding,
      evidence_classification: feedOnboardingFromBrowserEvidence(browserEvidence),
      effect_status: browserEvidence.feed_onboarding_effect_status
    };
  }

  if (credentialsProvided) {
    const login = await requestJson("POST", "/admin-auth/login", {
      "content-type": "application/json"
    }, JSON.stringify({ username, password }));
    checks.push(summarize("POST /admin-auth/login", login));
    const cookie = cookiePair(login.headers?.get("set-cookie") ?? null);
    const csrfFromLogin = boundedToken(login.json?.csrfToken);
    if (!login.ok || login.httpStatus !== 200 || login.json?.authenticated !== true || cookie === undefined) {
      auth = {
        credentials: "environment",
        login_attempted: true,
        classification: "AUTH_LOGIN_ATTEMPT_FAILED"
      };
    } else {
      const session = await requestJson("GET", "/admin-auth/session", { cookie });
      checks.push(summarize("GET /admin-auth/session authenticated", session));
      const csrf = boundedToken(session.json?.csrfToken) ?? csrfFromLogin;
      auth = {
        credentials: "environment",
        login_attempted: true,
        classification: session.ok && session.httpStatus === 200 && session.json?.authenticated === true
          ? "AUTHENTICATED_ADMIN_ACCEPTED"
          : "AUTH_LOGIN_ATTEMPT_FAILED"
      };

      const summary = feedRecheckOnly ? skipped("GET /admin-api/operations/summary authenticated") : await requestJson("GET", "/admin-api/operations/summary", { cookie });
      const drilldown = await requestJson("GET", "/admin-api/operations/drilldown", { cookie });
      if (!feedRecheckOnly) checks.push(summarize("GET /admin-api/operations/summary authenticated", summary));
      checks.push(summarize("GET /admin-api/operations/drilldown authenticated", drilldown));

      const eligibility = classifyFeedRecheckEligibility(drilldown.json);
      if (eligibility.kind === "none") {
        feedRecheck = {
          classification: "NO_ELIGIBLE_FEED_RECHECK_TARGET",
          effect_status: "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
          action_attempted: false,
          total_feeds: eligibility.totalFeeds,
          active_feeds: eligibility.activeFeeds,
          rows: eligibility.rows
        };
      } else if (!attemptFeedRecheck) {
        feedRecheck = {
          classification: "FEED_RECHECK_ELIGIBLE_TARGET_AVAILABLE_ACTION_NOT_ATTEMPTED",
          effect_status: "PENDING_OPERATOR_EXPLICIT_ACTION_ATTEMPT",
          action_attempted: false,
          target_display_id: eligibility.displayId
        };
      } else if (csrf === undefined) {
        feedRecheck = {
          classification: "FEED_RECHECK_ACTION_BLOCKED_MISSING_CSRF",
          effect_status: "PENDING_OPERATOR_RETRY",
          action_attempted: false,
          target_display_id: eligibility.displayId
        };
      } else {
        const action = await requestJson("POST", "/admin-api/operations/feed-recheck-requests", {
          cookie,
          "content-type": "application/json",
          "x-admin-csrf": csrf,
          "x-admin-idempotency-key": createIdempotencyKey()
        }, JSON.stringify({ actionRef: eligibility.actionRef, reason: "operator_request" }));
        checks.push(summarize("POST /admin-api/operations/feed-recheck-requests authenticated", action));
        feedRecheck = classifyFeedRecheckAction(action, eligibility.displayId);
      }
    }
  }

  const routeClassifications = classifyRoutes({
    healthz,
    live,
    ready,
    unauthSummary,
    unauthDrilldown,
    unauthFeedRecheck,
    getFeedRecheck,
    unauthFeedOnboarding,
    getFeedOnboarding,
    unknownAdminApi
  });
  const status = routeClassifications.critical.length === 0 && auth.classification !== "AUTH_LOGIN_ATTEMPT_FAILED" && (browserEvidenceFile === undefined || browserEvidenceAccepted)
    ? "OPERATOR_ACCEPTANCE_REDACTED_OK"
    : "OPERATOR_ACCEPTANCE_REDACTED_ATTENTION_REQUIRED";

  await finish({
    status,
    mode: "acceptance",
    base_url: baseUrl.origin,
    checks,
    auth,
    browser_evidence: browserEvidence,
    feed_recheck: feedRecheck,
    feed_onboarding: feedOnboarding,
    route_classifications: routeClassifications,
    risk_tier: riskTierSummary(),
    output: "redacted"
  });
}

function repositoryUpdatePreflight() {
  return {
    current_git_sha: git(["rev-parse", "HEAD"]),
    origin_main_sha: git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/u)[0] || "unavailable",
    auto_pull: false,
    apply_required: "operator must run git pull --ff-only origin main intentionally"
  };
}

function backendReadinessSummary() {
  return {
    env_files: {
      ".env.production": existsSync(path.join(backendRoot, ".env.production")),
      "deploy/runtime-image.env": existsSync(path.join(backendRoot, "deploy", "runtime-image.env"))
    },
    admin_auth_diagnostic: "npm run production:admin-auth:diagnose:redacted",
    recreate_helper: "npm run ops:production:recreate:api-worker -- --dry-run",
    recreate_apply: "npm run ops:production:recreate:api-worker -- --apply",
    output: "redacted"
  };
}

function frontendReadinessSummary() {
  return {
    env_file: existsSync(path.join(frontendRoot, ".env.production")),
    compose_diagnostic: "npm run production:diagnose:redacted",
    compose_config: "npm run ops:compose:config",
    recreate_dry_run: "npm run ops:compose:recreate",
    recreate_apply: "npm run ops:compose:recreate -- --apply",
    route_proof: "running generated Nginx config must contain summary, drilldown, feed-recheck, feed-onboarding, and no __ADMIN_UI_* markers",
    output: "redacted"
  };
}

function gitSummary() {
  return {
    current: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    origin_main: git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/u)[0] || "unavailable"
  };
}

function classifyRoutes(results) {
  const critical = [];
  const warnings = [];
  if (!isJsonStatus(results.unknownAdminApi, 404)) critical.push("ADMIN_API_ROUTE_UNAVAILABLE");
  if (!isJsonStatus(results.getFeedRecheck, 405)) critical.push("FEED_RECHECK_GET_NOT_405_JSON");
  if (!isJsonStatus(results.unauthFeedRecheck, 401)) critical.push("FEED_RECHECK_UNAUTH_POST_NOT_401_JSON");
  if (!isJsonStatus(results.getFeedOnboarding, 405)) critical.push("FEED_ONBOARDING_GET_NOT_405_JSON");
  if (!isJsonStatus(results.unauthFeedOnboarding, 401)) critical.push("FEED_ONBOARDING_UNAUTH_POST_NOT_401_JSON");
  if (!results.healthz.ok || results.healthz.httpStatus !== 200) warnings.push("HEALTHZ_UNAVAILABLE");
  if (!results.live.skipped && !isJsonStatus(results.live, 200)) warnings.push("STATUS_API_ROUTE_UNAVAILABLE");
  if (!results.ready.skipped && !isJsonStatus(results.ready, 200)) warnings.push("STATUS_API_ROUTE_UNAVAILABLE");
  if (!results.unauthSummary.skipped && !isJsonStatus(results.unauthSummary, 401)) warnings.push("ADMIN_API_SUMMARY_UNAUTH_UNEXPECTED");
  if (!isJsonStatus(results.unauthDrilldown, 401)) warnings.push("ADMIN_API_DRILLDOWN_UNAUTH_UNEXPECTED");
  return { critical, warnings };
}

function classifyFeedOnboardingRouteSmoke(results) {
  const accepted = isJsonStatus(results.unauthFeedOnboarding, 401) && isJsonStatus(results.getFeedOnboarding, 405);
  return {
    classification: accepted ? "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED" : "FEED_ONBOARDING_ROUTE_SMOKE_ATTENTION_REQUIRED",
    feed_onboarding_status: accepted ? "available" : "route_smoke_attention_required",
    action_attempted: false,
    manual_operator_action_required: true
  };
}

function feedRecheckFromBrowserEvidence(evidence) {
  const effectStatus = evidence.feed_recheck_effect_status ?? "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";
  const classification = evidence.classifications.includes("FEED_RECHECK_EFFECT_ACCEPTED")
    ? "FEED_RECHECK_EFFECT_ACCEPTED"
    : evidence.classifications.includes("PENDING_FEED_RECHECK_COOLDOWN")
      ? "PENDING_FEED_RECHECK_COOLDOWN"
      : evidence.classifications.includes("FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION")
        ? "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
        : evidence.classifications.includes("PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET") ||
            evidence.classifications.includes("BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET")
          ? "NO_ELIGIBLE_FEED_RECHECK_TARGET"
          : "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";
  return {
    classification,
    effect_status: effectStatus,
    action_attempted: false,
    source: "redacted_browser_evidence"
  };
}

function feedOnboardingFromBrowserEvidence(evidence) {
  if (evidence.classifications.includes("FEED_ONBOARDING_EFFECT_ACCEPTED")) return "FEED_ONBOARDING_EFFECT_ACCEPTED";
  if (evidence.classifications.includes("PENDING_FEED_ONBOARDING_ASYNC_PROCESSING")) return "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING";
  if (evidence.classifications.includes("FEED_ONBOARDING_REJECTED_SAFE_VALIDATION")) return "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION";
  return "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";
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
    feed_onboarding_effect_status: parsed?.feed_onboarding_effect_status ?? "unknown",
    evidence_sha256: parsed?.evidence_sha256 ?? "unavailable",
    output: "redacted"
  };
}

function classifySession(result) {
  if (!result.ok) return "AUTH_ROUTE_UNAVAILABLE";
  if (result.httpStatus === 501 || result.json?.configured === false || result.json?.reason === "not_configured") {
    return "AUTH_NOT_CONFIGURED_RESIDUAL";
  }
  if (result.httpStatus === 200 && result.json?.configured === true && result.json?.authenticated === false) {
    return "AUTH_CONFIGURED_UNAUTHENTICATED";
  }
  if (result.httpStatus === 200 && result.json?.authenticated === true) {
    return "AUTHENTICATED_ADMIN_ACCEPTED";
  }
  return "AUTH_ROUTE_UNAVAILABLE";
}

function classifyFeedRecheckEligibility(drilldown) {
  const feeds = drilldown?.feeds;
  const rows = Array.isArray(feeds?.rows) ? feeds.rows : [];
  const eligible = rows.find((row) => row?.canRequestRecheck === true && typeof row?.actionRef === "string");
  if (eligible === undefined) {
    return {
      kind: "none",
      totalFeeds: safeNumber(feeds?.total),
      activeFeeds: safeNumber(feeds?.active),
      rows: rows.length
    };
  }
  return {
    kind: "eligible",
    displayId: typeof eligible.displayId === "string" && /^feed_[a-f0-9]{10}$/u.test(eligible.displayId) ? eligible.displayId : "feed_redacted",
    actionRef: eligible.actionRef
  };
}

function classifyFeedRecheckAction(action, displayId) {
  if (action.ok && action.httpStatus === 202 && action.json?.status === "accepted") {
    return {
      classification: "FEED_RECHECK_ACTION_ACCEPTED",
      effect_status: "ACTION_ATTEMPTED_ACCEPTED",
      action_attempted: true,
      target_display_id: displayId
    };
  }
  if (action.ok && action.httpStatus === 200 && action.json?.status === "already_pending") {
    return {
      classification: "FEED_RECHECK_ACTION_ALREADY_PENDING",
      effect_status: "ACTION_ATTEMPTED_ALREADY_PENDING",
      action_attempted: true,
      target_display_id: displayId
    };
  }
  if (action.ok && action.httpStatus === 429 && action.json?.status === "rate_limited") {
    return {
      classification: "FEED_RECHECK_ACTION_RATE_LIMITED",
      effect_status: "ACTION_ATTEMPTED_RATE_LIMITED",
      action_attempted: true,
      target_display_id: displayId
    };
  }
  return {
    classification: "FEED_RECHECK_ACTION_ATTEMPT_FAILED",
    effect_status: "PENDING_OPERATOR_RETRY",
    action_attempted: true,
    target_display_id: displayId,
    http_status: action.httpStatus
  };
}

async function requestText(method, pathname, headers = {}, body = undefined) {
  const response = await request(method, pathname, headers, body);
  if (!response.ok) return response;
  return { ...response, text: response.text };
}

async function requestJson(method, pathname, headers = {}, body = undefined) {
  const response = await request(method, pathname, headers, body);
  if (!response.ok) return response;
  let json = null;
  try {
    json = response.text === "" ? null : JSON.parse(response.text);
  } catch {
    json = null;
  }
  return { ...response, json };
}

async function request(method, pathname, headers = {}, body = undefined) {
  const url = new URL(pathname, baseUrl);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...dropEmptyHeaders(headers)
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    return {
      ok: true,
      httpStatus: response.status,
      text: await response.text(),
      headers: response.headers
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: "none",
      transport_error: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "endpoint_unreachable",
      reason: "request_failed",
      headers: null,
      text: ""
    };
  }
}

function summarize(label, result) {
  if (result.skipped) return result;
  if (!result.ok) {
    return {
      label,
      http_status: "none",
      transport_error: result.transport_error,
      reason: result.reason
    };
  }
  return {
    label,
    http_status: result.httpStatus,
    json: isJson(result),
    status: allowlistedValue(result.json?.status),
    reason: allowlistedValue(result.json?.reason),
    configured: typeof result.json?.configured === "boolean" ? result.json.configured : "unknown",
    authenticated: typeof result.json?.authenticated === "boolean" ? result.json.authenticated : "unknown"
  };
}

function skipped(label) {
  return { skipped: true, label };
}

function isJsonStatus(result, status) {
  return result.ok === true && result.httpStatus === status && isJson(result);
}

function isJson(result) {
  return /application\/json/iu.test(result.headers?.get("content-type") ?? "");
}

function boundedToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(value) ? value : undefined;
}

function cookiePair(setCookie) {
  if (setCookie === null || setCookie === undefined) return undefined;
  const [pair] = setCookie.split(";", 1);
  return /^[^=]+=.+/u.test(pair) ? pair : undefined;
}

function syntheticActionRef() {
  return `feed_recheck_v1.${"A".repeat(64)}`;
}

function syntheticFeedOnboardingBody() {
  return JSON.stringify({ feedUrl: "https://onboarding.example.org/feed.xml", label: "Operator onboarding smoke" });
}

function createIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `recheck_${random.slice(0, 40)}`;
}

function dropEmptyHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined && value !== ""));
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

async function finish(payload) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (receiptFile !== undefined && receiptFile !== "") {
    const absoluteReceipt = path.resolve(receiptFile);
    await mkdir(path.dirname(absoluteReceipt), { recursive: true });
    const receipt = {
      ...payload,
      receipt_sha256: createHash("sha256").update(json).digest("hex")
    };
    await writeFile(absoluteReceipt, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(json);
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function git(argsForGit) {
  const result = spawnSync("git", argsForGit, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
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

function riskTierSummary() {
  return {
    critical_fail_closed: [
      "secret credential session cookie CSRF token exposure",
      "browser credential persistence",
      "write route missing auth CSRF idempotency",
      "admin API HTML fallback",
      "production mutation by Codex"
    ],
    high_blocks_apply: [
      "missing production env/image files for apply",
      "invalid upstream in apply mode",
      "unresolved Nginx template markers",
      "missing action route proxy"
    ],
    medium_warns_in_diagnose: [
      "credentials absent for auth smoke",
      "no eligible feed target",
      "local Docker unavailable",
      "host Node/npm warning when Docker Node 24 validation passes"
    ],
    low_info: ["npm update notices", "CRLF checkout warnings", "Prisma update notices"]
  };
}

function allowlistedValue(value) {
  const allowed = new Set([
    "accepted",
    "already_pending",
    "auth_unavailable",
    "created",
    "csrf_failed",
    "feed_onboarding_requires_post",
    "invalid_upstream_origin",
    "logged_out",
    "method_not_allowed",
    "not_configured",
    "not_found",
    "ok",
    "public_edge_upstream_rejected",
    "rate_limited",
    "ready",
    "unavailable",
    "unauthenticated",
    "upstream_forbidden",
    "upstream_unavailable"
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "none";
}

function safeNumber(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : "unknown";
}

function fail(message) {
  process.stderr.write(`operator-production-retest: ${message}\n`);
  process.exit(1);
}
