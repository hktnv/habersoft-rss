import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const loginSmoke = args.includes("--login-smoke");
const receiptFile = optionValue("--receipt-file") ?? process.env.ADMIN_AUTH_SMOKE_RECEIPT_FILE;
const baseUrl = normalizeBaseUrl(process.env.ADMIN_AUTH_SMOKE_BASE_URL ?? "http://127.0.0.1:8081");
const timeoutMs = Number(process.env.ADMIN_AUTH_SMOKE_TIMEOUT_MS ?? "5000");
const username = process.env.ADMIN_AUTH_SMOKE_USERNAME;
const password = process.env.ADMIN_AUTH_SMOKE_PASSWORD;

if (args.some((arg) => arg.startsWith("--username") || arg.startsWith("--password"))) {
  fail("credentials must be supplied through ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD, not command-line arguments");
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
  fail("ADMIN_AUTH_SMOKE_TIMEOUT_MS must be an integer between 1000 and 30000");
}

let jarDir;
let cookieJarDeleted = false;

try {
  const tempBase = process.env.ADMIN_AUTH_SMOKE_TMP_DIR ?? os.tmpdir();
  await mkdir(tempBase, { recursive: true });
  jarDir = await mkdtemp(path.join(tempBase, "rss-admin-auth-smoke-"));
  const jarFile = path.join(jarDir, "cookie.jar");

  if (loginSmoke && (username === undefined || username === "" || password === undefined || password === "")) {
    throw new Error("login smoke requires ADMIN_AUTH_SMOKE_USERNAME and ADMIN_AUTH_SMOKE_PASSWORD");
  }

  const checks = [];
  const firstSession = await requestJson("GET", "/admin-auth/session");
  checks.push(summarizeResponse("GET /admin-auth/session", firstSession));

  let classification = classifySession(firstSession);
  let cookieSummary = { login_set_cookie: "not-run" };

  if (loginSmoke && classification !== "AUTH_NOT_CONFIGURED_RESIDUAL") {
    const login = await requestJson("POST", "/admin-auth/login", {
      "content-type": "application/json"
    }, JSON.stringify({ username, password }));
    checks.push(summarizeResponse("POST /admin-auth/login", login));
    cookieSummary = summarizeSetCookie(login.headers.get("set-cookie"));

    const cookieHeader = cookieHeaderFromSetCookie(login.headers.get("set-cookie"));
    if (cookieHeader !== "") await writeFile(jarFile, cookieHeader, { encoding: "utf8", mode: 0o600 });

    const authenticatedSession = await requestJson("GET", "/admin-auth/session", {
      cookie: await readCookieJar(jarFile)
    });
    checks.push(summarizeResponse("GET /admin-auth/session after login", authenticatedSession));

    const logout = await requestJson("POST", "/admin-auth/logout", {
      cookie: await readCookieJar(jarFile)
    });
    checks.push(summarizeResponse("POST /admin-auth/logout", logout));

    await writeFile(jarFile, "", { encoding: "utf8", mode: 0o600 });
    const afterLogout = await requestJson("GET", "/admin-auth/session");
    checks.push(summarizeResponse("GET /admin-auth/session after logout", afterLogout));

    classification = classifyLoginProgression(login, authenticatedSession, logout, afterLogout);
  }

  await cleanupCookieJar();

  const output = {
    status: classification,
    mode: loginSmoke ? "login-smoke" : "session-classification",
    base_url: baseUrl.origin,
    checks,
    cookie: cookieSummary,
    temp_cookie_jar_deleted: cookieJarDeleted,
    output: "redacted"
  };

  if (receiptFile !== undefined && receiptFile !== "") {
    await mkdir(path.dirname(path.resolve(receiptFile)), { recursive: true });
    await writeFile(receiptFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (loginSmoke && classification !== "LOGOUT_ACCEPTED_SESSION_CLEARED") process.exitCode = 2;
} catch (error) {
  await cleanupCookieJar();
  if (error instanceof Error) fail(error.message);
  fail("unexpected admin auth smoke failure");
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a path`);
  return value;
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("ADMIN_AUTH_SMOKE_BASE_URL must be an absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) fail("ADMIN_AUTH_SMOKE_BASE_URL must use http or https");
  if (parsed.username !== "" || parsed.password !== "") fail("ADMIN_AUTH_SMOKE_BASE_URL must not include userinfo");
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

async function requestJson(method, pathname, headers = {}, body = undefined) {
  const url = new URL(pathname, baseUrl);
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

  const text = await response.text();
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }

  return { response, json, headers: response.headers };
}

function summarizeResponse(label, result) {
  return {
    label,
    http_status: result.response.status,
    configured: typeof result.json?.configured === "boolean" ? result.json.configured : "unknown",
    authenticated: typeof result.json?.authenticated === "boolean" ? result.json.authenticated : "unknown",
    status: typeof result.json?.status === "string" ? result.json.status : "none",
    reason: typeof result.json?.reason === "string" ? result.json.reason : "none"
  };
}

function classifySession(result) {
  if (result.response.status === 501 || result.json?.status === "not_configured" || result.json?.reason === "not_configured") {
    return "AUTH_NOT_CONFIGURED_RESIDUAL";
  }
  if (result.response.status === 200 && result.json?.configured === true && result.json?.authenticated === false) {
    return "AUTH_CONFIGURED_UNAUTHENTICATED";
  }
  return "AUTH_SMOKE_FAILED";
}

function classifyLoginProgression(login, authenticatedSession, logout, afterLogout) {
  if (login.response.status !== 200 || login.json?.authenticated !== true) return "AUTH_SMOKE_FAILED";
  if (authenticatedSession.response.status !== 200 || authenticatedSession.json?.authenticated !== true) return "AUTH_SMOKE_FAILED";
  if (logout.response.status !== 200) return "AUTH_SMOKE_FAILED";
  if (afterLogout.response.status === 200 && afterLogout.json?.authenticated === false) {
    return "LOGOUT_ACCEPTED_SESSION_CLEARED";
  }
  return "AUTH_SMOKE_FAILED";
}

function summarizeSetCookie(setCookie) {
  if (setCookie === null) return { login_set_cookie: "absent" };
  return {
    login_set_cookie: "present",
    http_only: /(?:^|;\s*)HttpOnly(?:;|$)/iu.test(setCookie),
    secure: /(?:^|;\s*)Secure(?:;|$)/iu.test(setCookie),
    same_site_lax: /(?:^|;\s*)SameSite=Lax(?:;|$)/iu.test(setCookie),
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
