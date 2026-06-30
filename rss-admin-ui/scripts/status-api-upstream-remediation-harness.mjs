import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms023d-local";
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms024b-networking-${suffix}`;
const internalBackendName = `rss-admin-ui-ms024b-internal-backend-${suffix}`;
const forbiddenBackendName = `rss-admin-ui-ms024b-forbidden-backend-${suffix}`;
const frontendName = `rss-admin-ui-ms024b-runtime-${suffix}`;
const sensitiveHeaders = {
  authorization: false,
  cookie: false,
  proxyAuthorization: false,
  agentKey: false
};

try {
  ensureImage();
  docker(["network", "create", network]);
  startSentinel(internalBackendName, "internal-backend", "internal");
  startSentinel(forbiddenBackendName, "forbidden-backend", "forbidden");
  await waitForContainerHttp(internalBackendName, "http://127.0.0.1:3100/__records");
  await waitForContainerHttp(forbiddenBackendName, "http://127.0.0.1:3100/__records");

  const missing = await runDegradedStatusScenario("missing-health-upstream", {}, "invalid_upstream_origin");
  const loopback = await runDegradedStatusScenario(
    "loopback-health-upstream",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://127.0.0.1:3200" },
    "invalid_upstream_origin"
  );
  const publicEdge = await runDegradedStatusScenario(
    "public-edge-health-upstream",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "https://rss.habersoft.com" },
    "public_edge_upstream_rejected"
  );
  const unreachable = await runDegradedStatusScenario(
    "unreachable-health-upstream",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://internal-backend:3999" },
    "upstream_unavailable"
  );
  const forbidden = await runDegradedStatusScenario(
    "forbidden-health-upstream",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://forbidden-backend:3100" },
    "upstream_forbidden"
  );
  const internal = await runInternalStatusScenario();
  const authStatic = await runAuthScenario("auth-static-not-configured", {}, 501, "not_configured");
  const authLoopback = await runAuthScenario(
    "auth-loopback-degraded",
    { ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://127.0.0.1:3200" },
    502,
    "invalid_upstream_origin"
  );
  const authPublicEdge = await runAuthScenario(
    "auth-public-edge-degraded",
    { ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "https://rss-panel.habersoft.com" },
    502,
    "public_edge_upstream_rejected"
  );

  console.log(
    JSON.stringify(
      {
        status: "status-api-production-networking-harness-ok",
        image,
        network,
        invalid_upstreams_start_static_runtime: true,
        healthz_available_in_degraded_mode: true,
        missing_upstream_scenario: missing,
        loopback_upstream_scenario: loopback,
        public_edge_upstream_scenario: publicEdge,
        unreachable_upstream_scenario: unreachable,
        forbidden_upstream_scenario: forbidden,
        internal_upstream_scenario: internal,
        auth_static_scenario: authStatic,
        auth_loopback_scenario: authLoopback,
        auth_public_edge_scenario: authPublicEdge,
        production_contact: false,
        output: "redacted"
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", frontendName], { allowFailure: true });
  docker(["rm", "-f", internalBackendName], { allowFailure: true });
  docker(["rm", "-f", forbiddenBackendName], { allowFailure: true });
  docker(["network", "rm", network], { allowFailure: true });
}

function startSentinel(name, alias, mode) {
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    network,
    "--network-alias",
    alias,
    "-e",
    `SENTINEL_MODE=${mode}`,
    "node:24-alpine",
    "node",
    "-e",
    sentinelProgram()
  ]);
}

async function runDegradedStatusScenario(label, env, expectedReason) {
  await withFrontend(label, env, async () => {
    const results = runFrontendRequests();
    assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", `${label} /healthz failed`);
    assert(results.env.status === 200, `${label} env-config.js failed`);
    assert(!/internal-backend|forbidden-backend|rss\.habersoft\.com|rss-panel\.habersoft\.com|127\.0\.0\.1:3200/iu.test(results.env.body), `${label} upstream leaked into env-config.js`);

    for (const result of [results.live, results.ready, results.query]) {
      assert(result.status === 502, `${label} status route did not fail closed`);
      assert(result.body.includes(`"reason":"${expectedReason}"`), `${label} bounded reason mismatch`);
      assert(!/Bad Gateway|connect\(\)|internal-backend|forbidden-backend|rss\.habersoft\.com|127\.0\.0\.1|nginx/iu.test(result.body), `${label} leaked raw upstream diagnostic`);
      assert(result.headers.setCookie === null, `${label} Set-Cookie leaked`);
      assert(result.headers.wwwAuthenticate === null, `${label} WWW-Authenticate leaked`);
      assert(/no-store/iu.test(result.headers.cacheControl ?? ""), `${label} status response is cacheable`);
    }
  });

  return {
    reason: expectedReason,
    healthz: 200,
    status_api: 502
  };
}

async function runInternalStatusScenario() {
  await withFrontend(
    "internal-status-upstream",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://internal-backend:3100" },
    async () => {
      const results = runFrontendRequests();
      assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "internal scenario /healthz failed");
      assert(results.env.status === 200, "internal scenario env-config.js failed");
      assert(!results.env.body.includes("internal-backend:3100"), "internal upstream leaked into env-config.js");
      assert(results.live.status === 200 && results.live.json?.status === "live", "internal live response failed");
      assert(results.ready.status === 200 && results.ready.json?.status === "ready", "internal ready response failed");
      assert(results.ready.json?.dependencies?.postgres === "up", "internal ready postgres mismatch");
      assert(results.ready.json?.dependencies?.redis === "up", "internal ready redis mismatch");
      assert(results.ready.json?.dependencies?.tenantAuth === "up", "internal ready tenantAuth mismatch");
      assert(results.live.headers.setCookie === null, "internal Set-Cookie leaked");
      assert(results.ready.headers.wwwAuthenticate === null, "internal WWW-Authenticate leaked");
      assert(/no-store/iu.test(results.ready.headers.cacheControl ?? ""), "internal ready response is cacheable");
      assertNoCorsHeaders(results.live.headers, "internal live route");
      assertNoCorsHeaders(results.ready.headers, "internal ready route");

      const records = sentinelRecords(internalBackendName);
      assert(records.length === 3, `expected 3 internal upstream records, got ${records.length}`);
      assert(records.filter((record) => record.path === "/health/live").length === 2, "internal live mapping mismatch");
      assert(records.filter((record) => record.path === "/health/ready").length === 1, "internal ready mapping mismatch");
      assertSafeHealthRecords(records);
    }
  );

  return {
    internal_live_status: 200,
    internal_ready_status: 200,
    upstream_records: 3
  };
}

async function runAuthScenario(label, env, expectedStatus, expectedReason) {
  await withFrontend(
    label,
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://internal-backend:3100", ...env },
    async () => {
      const result = runSingleFrontendRequest("/admin-auth/session");
      assert(result.status === expectedStatus, `${label} status mismatch`);
      assert(result.body.includes(`"reason":"${expectedReason}"`), `${label} reason mismatch`);
      assert(!/rss\.habersoft\.com|rss-panel\.habersoft\.com|127\.0\.0\.1|Bad Gateway|nginx/iu.test(result.body), `${label} leaked raw diagnostic`);
      assert(/no-store/iu.test(result.headers.cacheControl ?? ""), `${label} response is cacheable`);
    }
  );
  return {
    session_status: expectedStatus,
    reason: expectedReason
  };
}

async function withFrontend(label, env, callback) {
  docker(["rm", "-f", frontendName], { allowFailure: true });
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
    `ADMIN_UI_ENVIRONMENT_NAME=${label}`,
    ...Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
    image
  ]);
  await waitForFrontend();
  docker(["exec", frontendName, "nginx", "-t"]);
  await callback();
  docker(["rm", "-f", frontendName], { allowFailure: true });
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
          setCookie: response.headers.get("set-cookie"),
          wwwAuthenticate: response.headers.get("www-authenticate"),
          accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
          accessControlAllowCredentials: response.headers.get("access-control-allow-credentials"),
          accessControlAllowHeaders: response.headers.get("access-control-allow-headers"),
          accessControlAllowMethods: response.headers.get("access-control-allow-methods"),
          accessControlExposeHeaders: response.headers.get("access-control-expose-headers"),
          accessControlMaxAge: response.headers.get("access-control-max-age")
        }
      };
    }
    const sensitiveHeaders = {
      authorization: "Bearer redacted",
      cookie: "redacted=true",
      "proxy-authorization": "redacted",
      "x-agent-key": "redacted",
      "x-custom-credential": "redacted"
    };
    const results = {
      healthz: await request("/healthz"),
      env: await request("/env-config.js"),
      live: await request("/status-api/health/live", { headers: sensitiveHeaders }),
      ready: await request("/status-api/health/ready", { headers: sensitiveHeaders }),
      query: await request("/status-api/health/live?target=/health/ready", { headers: sensitiveHeaders })
    };
    console.log(JSON.stringify(results));
  `);
}

function runSingleFrontendRequest(pathname) {
  return runJsonInNetwork(`
    const response = await fetch("http://frontend:8080${pathname}");
    const body = await response.text();
    console.log(JSON.stringify({
      status: response.status,
      body,
      headers: {
        cacheControl: response.headers.get("cache-control"),
        setCookie: response.headers.get("set-cookie"),
        wwwAuthenticate: response.headers.get("www-authenticate")
      }
    }));
  `);
}

function assertSafeHealthRecords(records) {
  for (const record of records) {
    assert(record.method === "GET", "non-GET request reached upstream");
    assert(record.search === "", "query string reached upstream");
    assert(record.bodyPresent === false, "request body reached upstream");
    assert(JSON.stringify(record.sensitiveHeaders) === JSON.stringify(sensitiveHeaders), "sensitive client header reached upstream");
    assert(record.customCredentialLikeHeader === false, "credential-like custom header reached upstream");
  }
}

function sentinelRecords(container) {
  const result = docker([
    "exec",
    container,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3100/__records').then(async (r) => { console.log(await r.text()); }).catch(() => process.exit(1));"
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

function ensureImage() {
  const inspected = docker(["image", "inspect", image], { allowFailure: true });
  if (inspected.status === 0) return;

  if (image !== defaultImage) {
    throw new Error(`Docker image is not available: ${image}`);
  }

  docker(["build", "-t", image, "."], { timeoutMs: 600000 });
}

function sentinelProgram() {
  return String.raw`
    const http = require("node:http");
    const mode = process.env.SENTINEL_MODE;
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
        response.end(JSON.stringify(records));
        return;
      }

      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const headerNames = Object.keys(request.headers);
        records.push({
          method: request.method,
          path: parsed.pathname,
          search: parsed.search,
          bodyPresent: Buffer.concat(chunks).length > 0,
          sensitiveHeaders: Object.fromEntries(
            Object.entries(sensitiveNames).map(([key, header]) => [key, request.headers[header] !== undefined])
          ),
          customCredentialLikeHeader: headerNames.some((name) => /credential|token|key/i.test(name))
        });

        response.setHeader("Set-Cookie", "upstream=redacted; HttpOnly");
        response.setHeader("WWW-Authenticate", "Bearer realm=redacted");
        emitCorsHeaders(response);
        if (mode === "forbidden") {
          response.statusCode = 403;
          response.setHeader("Content-Type", "text/plain");
          response.end("forbidden by upstream diagnostic - should not reach browser");
          return;
        }

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
        response.statusCode = 404;
        response.end(JSON.stringify({ status: "unexpected" }));
      });
    });
    server.listen(3100, "0.0.0.0");

    function emitCorsHeaders(response) {
      response.setHeader("Access-Control-Allow-Origin", "https://evil.invalid");
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Headers", "authorization,cookie,x-agent-key");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
      response.setHeader("Access-Control-Expose-Headers", "set-cookie,www-authenticate");
      response.setHeader("Access-Control-Max-Age", "86400");
    }
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
    throw new Error(`docker ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return result;
}

function assertNoCorsHeaders(headers, label) {
  for (const [name, value] of Object.entries({
    "Access-Control-Allow-Origin": headers.accessControlAllowOrigin,
    "Access-Control-Allow-Credentials": headers.accessControlAllowCredentials,
    "Access-Control-Allow-Headers": headers.accessControlAllowHeaders,
    "Access-Control-Allow-Methods": headers.accessControlAllowMethods,
    "Access-Control-Expose-Headers": headers.accessControlExposeHeaders,
    "Access-Control-Max-Age": headers.accessControlMaxAge
  })) {
    assert(value === null, `${label} relayed upstream ${name}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
