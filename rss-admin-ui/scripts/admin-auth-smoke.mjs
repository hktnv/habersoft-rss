import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(JSON.stringify({
    status: "admin-auth-smoke-help",
    usage: "node scripts/admin-auth-smoke.mjs [--endpoint URL|--base-url URL] [--login-smoke] [--receipt-file PATH]",
    credential_policy: "credentials must be supplied only through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD",
    classifications: [
      "AUTH_NOT_CONFIGURED_RESIDUAL",
      "AUTH_CONFIGURED_UNAUTHENTICATED",
      "AUTH_LOGIN_ATTEMPT_FAILED",
      "AUTHENTICATED_ADMIN_ACCEPTED",
      "STATUS_API_ROUTE_UNAVAILABLE"
    ],
    output_policy: "diagnostics are redacted and do not print credential values"
  }, null, 2));
  process.exit(0);
}

const receiptFile = optionValue("--receipt-file") ?? process.env.ADMIN_AUTH_SMOKE_RECEIPT_FILE;
const endpoint = optionValue("--endpoint") ?? optionValue("--base-url") ?? process.env.ADMIN_AUTH_SMOKE_BASE_URL ?? "http://127.0.0.1:8081";
const baseUrl = normalizeBaseUrl(endpoint);
const timeoutMs = Number(process.env.ADMIN_AUTH_SMOKE_TIMEOUT_MS ?? "5000");
const username = process.env.ADMIN_AUTH_SMOKE_USERNAME;
const password = process.env.ADMIN_AUTH_SMOKE_PASSWORD;
const credentialsProvided = username !== undefined || password !== undefined;
const loginSmoke = args.includes("--login-smoke") || (username !== undefined && username !== "" && password !== undefined && password !== "");

if (args.some((arg) => arg.startsWith("--username") || arg.startsWith("--password"))) {
  fail("credentials must be supplied through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD, not command-line arguments");
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
  fail("ADMIN_AUTH_SMOKE_TIMEOUT_MS must be an integer between 1000 and 30000");
}

if ((loginSmoke || credentialsProvided) && (username === undefined || username === "" || password === undefined || password === "")) {
  fail("login smoke requires ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD");
}

let jarDir;
let cookieJarDeleted = false;

await main();

async function main() {
try {
  const tempBase = process.env.ADMIN_AUTH_SMOKE_TMP_DIR ?? os.tmpdir();
  await mkdir(tempBase, { recursive: true });
  jarDir = await mkdtemp(path.join(tempBase, "rss-admin-auth-smoke-"));
  const jarFile = path.join(jarDir, "cookie.jar");
  const checks = [];
  let cookieSummary = { login_set_cookie: "not-run" };

  const healthz = await requestText("GET", "/healthz");
  checks.push(summarizeResponse("GET /healthz", healthz));
  if (!healthz.ok) {
    await finish({
      classification: "ENDPOINT_UNREACHABLE",
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: false,
      exitCode: 2
    });
    return;
  }
  if (healthz.httpStatus !== 200 || healthz.text.trim() !== "ok") {
    await finish({
      classification: "HEALTHZ_UNAVAILABLE",
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: false,
      exitCode: 2
    });
    return;
  }

  const ready = await requestJson("GET", "/status-api/health/ready");
  checks.push(summarizeResponse("GET /status-api/health/ready", ready));
  const statusApiClassification = classifyStatusApi(ready);
  if (statusApiClassification !== undefined) {
    await finish({
      classification: statusApiClassification,
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: false,
      exitCode: 2
    });
    return;
  }

  const firstSession = await requestJson("GET", "/admin-auth/session");
  checks.push(summarizeResponse("GET /admin-auth/session", firstSession));
  const sessionClassification = classifySession(firstSession);
  if (sessionClassification !== "AUTH_CONFIGURED_UNAUTHENTICATED") {
    await finish({
      classification: sessionClassification,
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: false,
      exitCode: 2
    });
    return;
  }

  if (!loginSmoke) {
    await finish({
      classification: sessionClassification,
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: false,
      exitCode: 0
    });
    return;
  }

  const login = await requestJson(
    "POST",
    "/admin-auth/login",
    {
      "content-type": "application/json"
    },
    JSON.stringify({ username, password })
  );
  checks.push(summarizeResponse("POST /admin-auth/login", login));
  cookieSummary = summarizeSetCookie(login.headers?.get("set-cookie") ?? null);
  const loginAssessment = classifyLogin(login, cookieSummary);
  if (loginAssessment !== "LOGIN_ACCEPTED_COOKIE_PRESENT") {
    await finish({
      classification: "AUTH_LOGIN_ATTEMPT_FAILED",
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: true,
      failureReason: loginAssessment,
      exitCode: 2
    });
    return;
  }

  const cookieHeader = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
  if (cookieHeader !== "") await writeFile(jarFile, cookieHeader, { encoding: "utf8", mode: 0o600 });

  const authenticatedSession = await requestJson("GET", "/admin-auth/session", {
    cookie: await readCookieJar(jarFile)
  });
  checks.push(summarizeResponse("GET /admin-auth/session after login", authenticatedSession));
  if (!authenticatedSession.ok || authenticatedSession.httpStatus !== 200 || authenticatedSession.json?.authenticated !== true) {
    await finish({
      classification: "AUTH_LOGIN_ATTEMPT_FAILED",
      mode: smokeMode(),
      checks,
      cookie: cookieSummary,
      loginAttempted: true,
      failureReason: "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
      exitCode: 2
    });
    return;
  }

  const logout = await requestJson("POST", "/admin-auth/logout", {
    cookie: await readCookieJar(jarFile)
  });
  checks.push(summarizeResponse("POST /admin-auth/logout", logout));

  await writeFile(jarFile, "", { encoding: "utf8", mode: 0o600 });
  const afterLogout = await requestJson("GET", "/admin-auth/session");
  checks.push(summarizeResponse("GET /admin-auth/session after logout", afterLogout));
  const logoutAccepted = afterLogout.ok && afterLogout.httpStatus === 200 && afterLogout.json?.authenticated === false;
  await finish({
    classification: "AUTHENTICATED_ADMIN_ACCEPTED",
    mode: smokeMode(),
    checks,
    cookie: cookieSummary,
    loginAttempted: true,
    logout: {
      attempted: true,
      result: logout.ok && logout.httpStatus === 200 && logoutAccepted ? "accepted" : "safely_attempted_not_confirmed"
    },
    exitCode: 0
  });
} catch (error) {
  await cleanupCookieJar();
  if (error instanceof Error) fail(error.message);
  fail("unexpected admin auth smoke failure");
}
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("ADMIN_AUTH_SMOKE_BASE_URL/--endpoint must be an absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("ADMIN_AUTH_SMOKE_BASE_URL/--endpoint must use http or https");
  if (parsed.username !== "" || parsed.password !== "") fail("ADMIN_AUTH_SMOKE_BASE_URL/--endpoint must not include userinfo");
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
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

function summarizeResponse(label, result) {
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
    configured: typeof result.json?.configured === "boolean" ? result.json.configured : "unknown",
    authenticated: typeof result.json?.authenticated === "boolean" ? result.json.authenticated : "unknown",
    status: typeof result.json?.status === "string" ? allowlistedReason(result.json.status) : "none",
    reason: typeof result.json?.reason === "string" ? allowlistedReason(result.json.reason) : "none"
  };
}

function classifyStatusApi(result) {
  if (!result.ok) return "STATUS_API_ROUTE_UNAVAILABLE";
  if (result.httpStatus !== 200) return "STATUS_API_ROUTE_UNAVAILABLE";
  return undefined;
}

function classifySession(result) {
  if (!result.ok) return "AUTH_NOT_CONFIGURED_RESIDUAL";
  if (
    result.httpStatus === 501 ||
    result.json?.configured === false ||
    result.json?.status === "not_configured" ||
    result.json?.reason === "not_configured" ||
    result.json?.status === "auth_unavailable" ||
    result.json?.reason === "auth_unavailable"
  ) {
    return "AUTH_NOT_CONFIGURED_RESIDUAL";
  }
  if ([404, 405, 502, 503].includes(result.httpStatus)) return "AUTH_NOT_CONFIGURED_RESIDUAL";
  if (result.httpStatus === 200 && result.json?.configured === true && result.json?.authenticated === false) {
    return "AUTH_CONFIGURED_UNAUTHENTICATED";
  }
  return "AUTH_SMOKE_FAILED";
}

function classifyLogin(result, cookieSummary) {
  if (!result.ok) return "LOGIN_ROUTE_UNAVAILABLE";
  if (result.httpStatus === 401 || result.httpStatus === 403 || result.json?.reason === "invalid_credentials") return "INVALID_CREDENTIALS";
  if ([404, 405, 501, 502, 503].includes(result.httpStatus)) return "LOGIN_ROUTE_UNAVAILABLE";
  if (result.httpStatus !== 200 || result.json?.authenticated !== true) return "LOGIN_RESPONSE_NOT_AUTHENTICATED";
  if (cookieSummary.login_set_cookie !== "present") return "COOKIE_NOT_ESTABLISHED";
  return "LOGIN_ACCEPTED_COOKIE_PRESENT";
}

function summarizeSetCookie(setCookie) {
  if (setCookie === null) return { login_set_cookie: "absent" };
  return {
    login_set_cookie: "present",
    http_only: /(?:^|;\s*)HttpOnly(?:;|$)/iu.test(setCookie),
    secure: /(?:^|;\s*)Secure(?:;|$)/iu.test(setCookie),
    same_site_lax: /(?:^|;\s*)SameSite=Lax(?:;|$)/iu.test(setCookie),
    path_root: /(?:^|;\s*)Path=\/(?:;|$)/iu.test(setCookie),
    path_admin_auth: /(?:^|;\s*)Path=\/admin-auth(?:;|$)/iu.test(setCookie)
  };
}

function cookieHeaderFromSetCookie(setCookie) {
  if (setCookie === null) return "";
  const [pair] = setCookie.split(";", 1);
  if (!/^[^=]+=.+/u.test(pair)) return "";
  return pair;
}

async function readCookieJar(file) {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

function dropEmptyHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ""));
}

async function finish({ classification, mode, checks, cookie, loginAttempted, failureReason = "none", logout = undefined, exitCode }) {
  await cleanupCookieJar();
  const output = {
    status: classification,
    mode,
    base_url: baseUrl.origin,
    checks,
    cookie,
    credentials: credentialsProvided ? "environment" : "not_provided",
    login_attempted: loginAttempted,
    login_smoke_pending: classification === "AUTH_CONFIGURED_UNAUTHENTICATED",
    failure_reason: allowlistedFailureReason(failureReason),
    ...(logout === undefined ? {} : { logout }),
    diagnostic_classes: diagnosticClasses(classification),
    next_steps: nextSteps(classification),
    temp_cookie_jar_deleted: cookieJarDeleted,
    output: "redacted"
  };

  if (receiptFile !== undefined && receiptFile !== "") {
    await mkdir(path.dirname(path.resolve(receiptFile)), { recursive: true });
    await writeFile(receiptFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = exitCode;
}

function nextSteps(classification) {
  const common = [
    "run npm run ops:compose:ps from rss-admin-ui",
    "run npm run ops:compose:logs -- rss-admin-ui from rss-admin-ui"
  ];
  switch (classification) {
    case "ENDPOINT_UNREACHABLE":
    case "HEALTHZ_UNAVAILABLE":
      return ["frontend container may be down/restarting", ...common, "check the edge route to the admin UI loopback port"];
    case "STATUS_API_ROUTE_UNAVAILABLE":
      return [
        "status-api route is unavailable or cannot reach the backend",
        "after backend API/image/network/admin-auth env recreate, run npm run ops:compose:recreate -- --apply from rss-admin-ui",
        "do not use 127.0.0.1 inside Docker bridge; use backend service alias or proven host-gateway",
        ...common
      ];
    case "STATUS_API_UPSTREAM_MISCONFIGURED":
      return ["admin UI health upstream is misconfigured", "after backend changes run npm run ops:compose:recreate -- --apply from rss-admin-ui", "do not use 127.0.0.1 inside Docker bridge; use backend service alias or proven host-gateway", ...common];
    case "STATUS_API_UPSTREAM_UNAVAILABLE":
      return ["status-api upstream is down, forbidden, or unreachable from the admin UI container", "after backend changes run npm run ops:compose:recreate -- --apply from rss-admin-ui", "verify backend-network service DNS or proven host-gateway reachability", ...common];
    case "AUTH_NOT_CONFIGURED_RESIDUAL":
      return [
        "backend admin-auth env likely not loaded",
        "place backend admin-auth env in the backend API runtime, not only the frontend env",
        "run backend admin-auth config verifier with a redacted operator env file",
        "after operator rollback/config decision, recreate backend API/worker so the backend runtime sees admin-auth env",
        "then recreate frontend admin UI with npm run ops:compose:recreate -- --apply from rss-admin-ui",
        "rerun npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com"
      ];
    case "AUTH_CONFIGURED_UNAUTHENTICATED":
      return [
        "login_smoke_pending: backend auth is configured and unauthenticated before login",
        "run redacted login smoke with ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD set as environment variables",
        "do not pass credentials through command-line arguments"
      ];
    case "AUTH_LOGIN_ATTEMPT_FAILED":
      return [
        "login was attempted from environment-provided credentials but did not establish an authenticated session",
        "verify the operator-provided username/password and backend admin-auth config without pasting secrets into logs",
        "rerun npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com"
      ];
    case "AUTHENTICATED_ADMIN_ACCEPTED":
      return ["preserve only the redacted AUTHENTICATED_ADMIN_ACCEPTED result and do not copy credentials, cookies, or raw session material"];
    case "ADMIN_AUTH_UPSTREAM_MISCONFIGURED":
    case "ADMIN_AUTH_ROUTE_UNAVAILABLE":
    case "LOGIN_ROUTE_UNAVAILABLE":
      return ["admin UI auth upstream misconfigured or unavailable", "do not use 127.0.0.1 inside Docker bridge; use backend service alias or proven host-gateway", ...common];
    case "INVALID_CREDENTIALS":
      return ["invalid credentials or wrong configured admin username", "verify the operator-provided username and password without pasting secrets into logs"];
    case "COOKIE_NOT_ESTABLISHED":
      return ["login succeeded but session cookie was not established", "check backend Set-Cookie attributes and same-origin /admin-auth edge routing"];
    case "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED":
      return ["cookie/session not established or backend session store unavailable", "check Redis and backend admin-auth session configuration"];
    case "LOGOUT_FAILED":
      return ["logout failed or session was not cleared", "check backend /admin-auth/logout and session store behavior"];
    default:
      return common;
  }
}

function diagnosticClasses(classification) {
  if (classification === "AUTH_CONFIGURED_UNAUTHENTICATED") {
    return ["auth_configured_unauthenticated", "authenticated_login_not_yet_proven"];
  }
  if (classification === "AUTH_LOGIN_ATTEMPT_FAILED") return ["authenticated_login_not_yet_proven"];
  if (classification === "STATUS_API_ROUTE_UNAVAILABLE") return ["frontend_proxy_recreate_required"];
  if (classification !== "AUTH_NOT_CONFIGURED_RESIDUAL") return [];
  return [
    "required_missing",
    "frontend_proxy_recreate_required",
    "backend_admin_auth_mode_disabled_or_missing",
    "backend_admin_username_missing_or_placeholder",
    "backend_password_hash_missing_placeholder_or_invalid",
    "backend_session_secret_missing_or_weak",
    "backend_redis_or_session_dependency_unreachable",
    "frontend_proxy_reachable_backend_auth_endpoint_reports_not_configured"
  ];
}

function allowlistedFailureReason(value) {
  const allowed = new Set([
    "none",
    "LOGIN_ROUTE_UNAVAILABLE",
    "INVALID_CREDENTIALS",
    "COOKIE_NOT_ESTABLISHED",
    "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
    "LOGIN_RESPONSE_NOT_AUTHENTICATED"
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "none";
}

function allowlistedReason(value) {
  const allowed = new Set([
    "authenticated",
    "auth_unavailable",
    "invalid_credentials",
    "invalid_upstream_origin",
    "logged_out",
    "method_not_allowed",
    "not_configured",
    "public_edge_upstream_rejected",
    "ready",
    "upstream_dns_unresolved",
    "upstream_forbidden",
    "upstream_unavailable",
    "unauthenticated",
    "unavailable"
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "none";
}

function smokeMode() {
  return loginSmoke ? "login-smoke" : "session-classification";
}

async function cleanupCookieJar() {
  if (jarDir === undefined) {
    cookieJarDeleted = true;
    return;
  }
  await rm(jarDir, { recursive: true, force: true });
  cookieJarDeleted = true;
}

function fail(message) {
  process.stderr.write(`admin-auth-smoke: ${message}\n`);
  process.exit(1);
}
