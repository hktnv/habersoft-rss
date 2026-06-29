import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms023d-local";
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms023d-auth-${suffix}`;
const sentinelName = `rss-admin-ui-ms023d-auth-sentinel-${suffix}`;
const frontendName = `rss-admin-ui-ms023d-auth-runtime-${suffix}`;

try {
  ensureImage();
  docker(["network", "create", network]);
  docker([
    "run",
    "-d",
    "--name",
    sentinelName,
    "--network",
    network,
    "--network-alias",
    "sentinel",
    "node:24-alpine",
    "node",
    "-e",
    sentinelProgram()
  ]);
  await waitForContainerHttp(sentinelName, "http://127.0.0.1:3100/__records");
  docker([
    "run",
    "-d",
    "--name",
    frontendName,
    "--network",
    network,
    "--network-alias",
    "frontend",
    "-e",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://sentinel:3100",
    "-e",
    "ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://sentinel:3100",
    "-e",
    "ADMIN_UI_ENVIRONMENT_NAME=auth-proxy-harness",
    image
  ]);
  await waitForFrontend();
  docker(["exec", frontendName, "nginx", "-t"]);

  const results = runFrontendRequests();
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "frontend /healthz failed");
  assert(results.env.status === 200, "env-config.js failed");
  assert(!results.env.body.includes("sentinel:3100"), "auth upstream leaked into env-config.js");

  assert(results.session.status === 200, "session proxy failed");
  assert(results.session.json?.reason === "unauthenticated", "session body mismatch");
  assert(results.login.status === 200, "login proxy failed");
  assert(results.login.json?.authenticated === true, "login body mismatch");
  assert(/HttpOnly/iu.test(results.login.headers.setCookie ?? ""), "login Set-Cookie was not relayed");
  assert(results.logout.status === 200, "logout proxy failed");
  assert(/Max-Age=0/iu.test(results.logout.headers.setCookie ?? ""), "logout clear cookie was not relayed");

  assert(results.postSession.status === 405, "POST session was not rejected at frontend");
  assert(results.getLogin.status === 405, "GET login was not rejected at frontend");
  assert(results.getLogout.status === 405, "GET logout was not rejected at frontend");
  assert(results.unknown.status === 404, "unknown auth path was not rejected");
  assert(results.sessionQuery.status === 200, "session query did not map to exact upstream path");

  const records = authRecords();
  assert(records.length === 4, `expected 4 upstream auth records, received ${records.length}`);
  assert(records.filter((record) => record.path === "/admin-auth/session").length === 2, "session upstream mapping mismatch");
  assert(records.filter((record) => record.path === "/admin-auth/login").length === 1, "login upstream mapping mismatch");
  assert(records.filter((record) => record.path === "/admin-auth/logout").length === 1, "logout upstream mapping mismatch");

  for (const record of records) {
    assert(record.search === "", "query string reached auth upstream");
    assert(record.sensitiveHeaders.authorization === false, "authorization header reached auth upstream");
    assert(record.sensitiveHeaders.proxyAuthorization === false, "proxy authorization header reached auth upstream");
    assert(record.sensitiveHeaders.agentKey === false, "agent key header reached auth upstream");
    assert(record.customCredentialLikeHeader === false, "credential-like custom header reached auth upstream");
    assert(record.sensitiveHeaders.cookie === true, "session cookie was not forwarded to auth upstream");
  }

  const loginRecord = records.find((record) => record.path === "/admin-auth/login");
  assert(loginRecord?.method === "POST", "login method mismatch");
  assert(loginRecord.body === '{"username":"admin","password":"redacted"}', "login body mismatch");

  docker(["stop", sentinelName]);
  const unavailable = runSingleFrontendRequest("/admin-auth/session");
  assert(unavailable.status === 502, "unavailable auth upstream did not become a bounded transport failure");
  assert(!unavailable.body.includes("sentinel"), "transport failure leaked upstream identity");

  console.log(
    JSON.stringify(
      {
        status: "auth-proxy-harness-ok",
        image,
        network,
        exact_routes: ["/admin-auth/session", "/admin-auth/login", "/admin-auth/logout"],
        upstream_records: records.length,
        unavailable_status: unavailable.status
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", frontendName], { allowFailure: true });
  docker(["rm", "-f", sentinelName], { allowFailure: true });
  docker(["network", "rm", network], { allowFailure: true });
}

function ensureImage() {
  const inspected = docker(["image", "inspect", image], { allowFailure: true });
  if (inspected.status === 0) return;

  if (image !== defaultImage) {
    throw new Error(`Docker image is not available: ${image}`);
  }

  docker(["build", "-t", image, "."], { timeoutMs: 600000 });
}

function runFrontendRequests() {
  return runJsonInNetwork(`
    const base = "http://frontend:8080";
    async function request(path, init) {
      const response = await fetch(base + path, { redirect: "manual", ...init });
      const body = await response.text();
      let json = null;
      try { json = JSON.parse(body); } catch {}
      return {
        status: response.status,
        body,
        json,
        headers: {
          cacheControl: response.headers.get("cache-control"),
          contentType: response.headers.get("content-type"),
          setCookie: response.headers.get("set-cookie"),
          wwwAuthenticate: response.headers.get("www-authenticate")
        }
      };
    }
    const sensitiveHeaders = {
      authorization: "redacted",
      cookie: "habersoft_admin_session=opaque",
      "proxy-authorization": "redacted",
      "x-agent-key": "redacted",
      "x-custom-credential": "redacted"
    };
    const results = {
      healthz: await request("/healthz"),
      env: await request("/env-config.js"),
      session: await request("/admin-auth/session", { headers: sensitiveHeaders }),
      sessionQuery: await request("/admin-auth/session?token=example", { headers: sensitiveHeaders }),
      login: await request("/admin-auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "redacted" }),
        headers: { ...sensitiveHeaders, "content-type": "application/json" }
      }),
      logout: await request("/admin-auth/logout", { method: "POST", headers: sensitiveHeaders }),
      postSession: await request("/admin-auth/session", { method: "POST", body: "mutate=true", headers: sensitiveHeaders }),
      getLogin: await request("/admin-auth/login", { headers: sensitiveHeaders }),
      getLogout: await request("/admin-auth/logout", { headers: sensitiveHeaders }),
      unknown: await request("/admin-auth/unknown", { headers: sensitiveHeaders })
    };
    console.log(JSON.stringify(results));
  `);
}

function runSingleFrontendRequest(pathname) {
  return runJsonInNetwork(`
    const response = await fetch("http://frontend:8080${pathname}");
    console.log(JSON.stringify({ status: response.status, body: await response.text() }));
  `);
}

function authRecords() {
  const result = docker([
    "exec",
    sentinelName,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3100/__records?surface=auth').then(async (r) => { console.log(await r.text()); }).catch(() => process.exit(1));"
  ]);
  return JSON.parse(result.stdout);
}

function runJsonInNetwork(program) {
  const result = docker(["run", "--rm", "--network", network, "node:24-alpine", "node", "-e", program], {
    timeoutMs: 120000
  });
  return JSON.parse(result.stdout);
}

async function waitForFrontend() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(
      [
        "run",
        "--rm",
        "--network",
        network,
        "node:24-alpine",
        "node",
        "-e",
        "fetch('http://frontend:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));"
      ],
      { allowFailure: true, timeoutMs: 30000 }
    );
    if (result.status === 0) return;
    await sleep(1000);
  }
  throw new Error("frontend runtime did not become healthy");
}

async function waitForContainerHttp(container, url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = docker(
      [
        "exec",
        container,
        "node",
        "-e",
        `fetch('${url}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));`
      ],
      { allowFailure: true, timeoutMs: 30000 }
    );
    if (result.status === 0) return;
    await sleep(1000);
  }
  throw new Error(`${container} did not become healthy`);
}

function sentinelProgram() {
  return String.raw`
    const http = require("node:http");
    const records = [];
    const sensitiveNames = {
      authorization: "authorization",
      cookie: "cookie",
      proxyAuthorization: "proxy-authorization",
      agentKey: "x-agent-key"
    };
    const server = http.createServer((request, response) => {
      const parsed = new URL(request.url, "http://sentinel");
      if (parsed.pathname === "/__records") {
        response.setHeader("Content-Type", "application/json");
        const surface = parsed.searchParams.get("surface");
        response.end(JSON.stringify(surface === "auth" ? records.filter((record) => record.path.startsWith("/admin-auth/")) : records));
        return;
      }

      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const headerNames = Object.keys(request.headers);
        records.push({
          method: request.method,
          path: parsed.pathname,
          search: parsed.search,
          body,
          bodyPresent: body.length > 0,
          sensitiveHeaders: Object.fromEntries(
            Object.entries(sensitiveNames).map(([key, header]) => [key, request.headers[header] !== undefined])
          ),
          customCredentialLikeHeader: headerNames.some((name) => /credential|token|key/i.test(name))
        });

        response.setHeader("Content-Type", "application/json");
        if (parsed.pathname === "/health/live") {
          response.end(JSON.stringify({ status: "live" }));
          return;
        }

        if (parsed.pathname === "/health/ready") {
          response.end(JSON.stringify({
            status: "ready",
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
          }));
          return;
        }

        if (parsed.pathname === "/admin-auth/session") {
          response.end(JSON.stringify({ configured: true, authenticated: false, reason: "unauthenticated" }));
          return;
        }

        if (parsed.pathname === "/admin-auth/login") {
          response.setHeader("Set-Cookie", "habersoft_admin_session=opaque; HttpOnly; Path=/admin-auth; SameSite=Lax");
          response.end(JSON.stringify({
            configured: true,
            authenticated: true,
            principal: { kind: "single_admin", displayName: "Admin" },
            expiresAt: "2026-06-20T00:00:00.000Z"
          }));
          return;
        }

        if (parsed.pathname === "/admin-auth/logout") {
          response.setHeader("Set-Cookie", "habersoft_admin_session=; HttpOnly; Path=/admin-auth; SameSite=Lax; Max-Age=0");
          response.end(JSON.stringify({ configured: true, authenticated: false, reason: "logged_out" }));
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ status: "unexpected" }));
      });
    });
    server.listen(3100, "0.0.0.0");
  `;
}

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: frontendRoot,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
