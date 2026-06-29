import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms023c-local";
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms023c-networking-${suffix}`;
const publicEdgeName = `rss-admin-ui-ms023c-public-edge-${suffix}`;
const internalBackendName = `rss-admin-ui-ms023c-internal-backend-${suffix}`;
const publicFrontendName = `rss-admin-ui-ms023c-public-runtime-${suffix}`;
const unreachableFrontendName = `rss-admin-ui-ms023c-unreachable-runtime-${suffix}`;
const internalFrontendName = `rss-admin-ui-ms023c-internal-runtime-${suffix}`;
const sensitiveHeaders = {
  authorization: false,
  cookie: false,
  proxyAuthorization: false,
  agentKey: false
};

try {
  ensureImage();
  docker(["network", "create", network]);
  startSentinel(publicEdgeName, "public-edge", "public-edge");
  startSentinel(internalBackendName, "internal-backend", "internal-backend");
  await waitForContainerHttp(publicEdgeName, "http://127.0.0.1:3100/__records");
  await waitForContainerHttp(internalBackendName, "http://127.0.0.1:3100/__records");

  assertKnownPublicEdgeHostnamesRejected();
  assertLoopbackHostnamesRejected();
  const publicEdge = await runPublicEdgeScenario();
  const unreachable = await runUnreachableScenario();
  const internal = await runInternalScenario();

  console.log(
    JSON.stringify(
      {
        status: "status-api-production-networking-harness-ok",
        image,
        network,
        known_public_edge_startup_rejected: true,
        loopback_startup_rejected: true,
        public_edge_scenario: publicEdge,
        unreachable_upstream_scenario: unreachable,
        internal_upstream_scenario: internal,
        production_contact: false,
        output: "redacted"
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", publicFrontendName], { allowFailure: true });
  docker(["rm", "-f", unreachableFrontendName], { allowFailure: true });
  docker(["rm", "-f", internalFrontendName], { allowFailure: true });
  docker(["rm", "-f", publicEdgeName], { allowFailure: true });
  docker(["rm", "-f", internalBackendName], { allowFailure: true });
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

function assertKnownPublicEdgeHostnamesRejected() {
  for (const [name, value, extraEnv] of [
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "https://rss.habersoft.com", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "https://rss.habersoft.com", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]],
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "https://rss-panel.habersoft.com", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "https://rss-panel.habersoft.com", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]]
  ]) {
    const result = docker(["run", "--rm", "--network", network, ...extraEnv, "-e", `${name}=${value}`, image], {
      allowFailure: true,
      timeoutMs: 120000
    });
    assert(result.status !== 0, `${name} public edge hostname was not rejected at startup`);
    assert(/internal backend origin/iu.test(result.stderr), `${name} rejection did not explain internal upstream requirement`);
  }
}

function assertLoopbackHostnamesRejected() {
  for (const [name, value, extraEnv] of [
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "http://127.0.0.1:3200", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "http://127.0.0.1:3200", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]],
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "http://localhost:3200", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "http://localhost:3200", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]],
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "http://[::1]:3200", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "http://[::1]:3200", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]],
    ["ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", "http://0.0.0.0:3200", []],
    ["ADMIN_UI_AUTH_UPSTREAM_ORIGIN", "http://0.0.0.0:3200", ["-e", "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100"]]
  ]) {
    const result = docker(["run", "--rm", "--network", network, ...extraEnv, "-e", `${name}=${value}`, image], {
      allowFailure: true,
      timeoutMs: 120000
    });
    assert(result.status !== 0, `${name} loopback/container-local hostname was not rejected at startup`);
    assert(/container-local|loopback|backend-network service DNS/iu.test(result.stderr), `${name} rejection did not explain production Docker bridge loopback requirement`);
  }
}

async function runPublicEdgeScenario() {
  docker([
    "run",
    "-d",
    "--name",
    publicFrontendName,
    "--network",
    network,
    "--network-alias",
    "frontend",
    "-e",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://public-edge:3100",
    "-e",
    "ADMIN_UI_ENVIRONMENT_NAME=status-api-upstream-blocked-repro",
    image
  ]);
  await waitForFrontend();
  docker(["exec", publicFrontendName, "nginx", "-t"]);

  const results = runFrontendRequests();
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "public-edge scenario /healthz failed");
  assert(results.env.status === 200, "public-edge scenario env-config.js failed");
  assert(!results.env.body.includes("public-edge:3100"), "public-edge upstream leaked into env-config.js");
  assert(results.live.status === 502, "public-edge live response was not converted to a bounded failure");
  assert(results.ready.status === 502, "public-edge ready response was not converted to a bounded failure");
  assert(results.query.status === 502, "public-edge query response was not converted to a bounded failure");
  for (const result of [results.live, results.ready, results.query]) {
    assert(result.body.includes('"reason":"upstream_forbidden"'), "bounded public-edge failure reason missing");
    assert(!/diagnostic|public edge|forbidden by public edge/iu.test(result.body), "raw public-edge diagnostic leaked");
    assert(result.headers.setCookie === null, "public-edge Set-Cookie leaked");
    assert(result.headers.wwwAuthenticate === null, "public-edge WWW-Authenticate leaked");
    assert(/no-store/iu.test(result.headers.cacheControl ?? ""), "public-edge status response is cacheable");
  }

  const records = sentinelRecords(publicEdgeName);
  assert(records.length === 3, `expected 3 public-edge upstream records, got ${records.length}`);
  assert(records.filter((record) => record.path === "/health/live").length === 2, "public-edge live mapping mismatch");
  assert(records.filter((record) => record.path === "/health/ready").length === 1, "public-edge ready mapping mismatch");
  assertSafeHealthRecords(records);

  docker(["rm", "-f", publicFrontendName], { allowFailure: true });
  return {
    public_edge_403_reproduced_as_safe_failure: true,
    browser_statuses: {
      live: results.live.status,
      ready: results.ready.status
    },
    upstream_records: records.length
  };
}

async function runUnreachableScenario() {
  docker([
    "run",
    "-d",
    "--name",
    unreachableFrontendName,
    "--network",
    network,
    "--network-alias",
    "frontend",
    "-e",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3999",
    "-e",
    "ADMIN_UI_ENVIRONMENT_NAME=status-api-upstream-unreachable",
    image
  ]);
  await waitForFrontend();
  docker(["exec", unreachableFrontendName, "nginx", "-t"]);

  const results = runFrontendRequests();
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "unreachable scenario /healthz failed");
  assert(results.env.status === 200, "unreachable scenario env-config.js failed");
  assert(!results.env.body.includes("internal-backend:3999"), "unreachable upstream leaked into env-config.js");
  assert(results.live.status === 502, "unreachable live response was not converted to a bounded failure");
  assert(results.ready.status === 502, "unreachable ready response was not converted to a bounded failure");
  assert(results.query.status === 502, "unreachable query response was not converted to a bounded failure");
  for (const result of [results.live, results.ready, results.query]) {
    assert(result.body.includes('"reason":"upstream_unavailable"'), "bounded unreachable failure reason missing");
    assert(!/Bad Gateway|connect\(\)|internal-backend|3999|nginx/iu.test(result.body), "raw unreachable upstream diagnostic leaked");
    assert(result.headers.setCookie === null, "unreachable Set-Cookie leaked");
    assert(result.headers.wwwAuthenticate === null, "unreachable WWW-Authenticate leaked");
    assert(/no-store/iu.test(result.headers.cacheControl ?? ""), "unreachable status response is cacheable");
  }

  docker(["rm", "-f", unreachableFrontendName], { allowFailure: true });
  return {
    upstream_unreachable_reproduced_as_safe_failure: true,
    browser_statuses: {
      live: results.live.status,
      ready: results.ready.status
    }
  };
}

async function runInternalScenario() {
  docker([
    "run",
    "-d",
    "--name",
    internalFrontendName,
    "--network",
    network,
    "--network-alias",
    "frontend",
    "-e",
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://internal-backend:3100",
    "-e",
    "ADMIN_UI_ENVIRONMENT_NAME=status-api-upstream-remediated",
    image
  ]);
  await waitForFrontend();
  docker(["exec", internalFrontendName, "nginx", "-t"]);

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

  const records = sentinelRecords(internalBackendName);
  assert(records.length === 3, `expected 3 internal upstream records, got ${records.length}`);
  assert(records.filter((record) => record.path === "/health/live").length === 2, "internal live mapping mismatch");
  assert(records.filter((record) => record.path === "/health/ready").length === 1, "internal ready mapping mismatch");
  assertSafeHealthRecords(records);

  docker(["rm", "-f", internalFrontendName], { allowFailure: true });
  return {
    internal_live_status: results.live.status,
    internal_ready_status: results.ready.status,
    readiness: results.ready.json?.dependencies,
    upstream_records: records.length
  };
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
          wwwAuthenticate: response.headers.get("www-authenticate")
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
        if (mode === "public-edge") {
          response.statusCode = 403;
          response.setHeader("Content-Type", "text/plain");
          response.end("forbidden by public edge diagnostic - should not reach browser");
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
