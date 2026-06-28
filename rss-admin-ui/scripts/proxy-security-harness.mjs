import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms023a-r2-local";
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms023a-r2-health-${suffix}`;
const sentinelName = `rss-admin-ui-ms023a-r2-sentinel-${suffix}`;
const frontendName = `rss-admin-ui-ms023a-r2-runtime-${suffix}`;

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
    "ADMIN_UI_ENVIRONMENT_NAME=synthetic-harness",
    image
  ]);
  await waitForFrontend();
  docker(["exec", frontendName, "nginx", "-t"]);

  const results = runFrontendRequests();
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "frontend /healthz failed");
  assert(results.index.status === 200 && results.index.body.includes("Habersoft RSS Admin"), "static app failed");
  assert(results.env.status === 200, "env-config.js failed");
  assert(!results.env.body.includes("sentinel:3100"), "upstream origin leaked into env-config.js");
  assert(!results.index.body.includes("sentinel:3100"), "upstream origin leaked into index.html");
  assert(results.live.status === 200, "live mapping failed");
  assert(results.live.body.includes('"status":"live"'), "live payload mismatch");
  assert(results.ready.status === 503, "ready 503 was not preserved");
  assert(results.ready.body.includes('"status":"not_ready"'), "ready payload mismatch");
  assert(results.query.status === 200, "query-insulated live mapping failed");
  assert(results.unknown.status === 404, "unknown status path was not rejected");
  assert(results.post.status === 405, "POST was not rejected");
  assert(results.duplicateSlash.status === 404, "duplicate slash path widened the route set");
  assert(results.suffix.status === 404, "suffix path widened the route set");
  assert(results.encodedTraversal.status === 404, "encoded traversal path widened the route set");
  assert(results.live.headers.setCookie === null, "Set-Cookie was relayed to the browser surface");
  assert(results.ready.headers.wwwAuthenticate === null, "WWW-Authenticate was relayed to the browser surface");
  assert(/no-store/iu.test(results.live.headers.cacheControl ?? ""), "live route is cacheable");

  const records = sentinelRecords();
  assert(records.length === 3, `expected 3 upstream health records, received ${records.length}`);
  assert(records.filter((record) => record.path === "/health/live").length === 2, "live upstream mapping mismatch");
  assert(records.filter((record) => record.path === "/health/ready").length === 1, "ready upstream mapping mismatch");

  for (const record of records) {
    assert(record.method === "GET", "non-GET request reached upstream");
    assert(record.search === "", "query string reached upstream");
    assert(record.bodyPresent === false, "request body reached upstream");
    assert(record.sensitiveHeaders.authorization === false, "authorization header reached upstream");
    assert(record.sensitiveHeaders.cookie === false, "cookie header reached upstream");
    assert(record.sensitiveHeaders.proxyAuthorization === false, "proxy authorization header reached upstream");
    assert(record.sensitiveHeaders.agentKey === false, "agent key header reached upstream");
    assert(record.customCredentialLikeHeader === false, "credential-like custom header reached upstream");
  }

  docker(["stop", sentinelName]);
  const unavailable = runSingleFrontendRequest("/status-api/health/live");
  assert([502, 504].includes(unavailable.status), "unavailable upstream did not become a bounded transport failure");
  assert(!unavailable.body.includes("sentinel"), "transport failure leaked upstream identity");

  console.log(
    JSON.stringify(
      {
        status: "proxy-security-harness-ok",
        image,
        network,
        exact_routes: ["/status-api/health/live", "/status-api/health/ready"],
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
      const response = await fetch(base + path, init);
      return {
        status: response.status,
        body: await response.text(),
        headers: {
          setCookie: response.headers.get("set-cookie"),
          wwwAuthenticate: response.headers.get("www-authenticate"),
          cacheControl: response.headers.get("cache-control")
        }
      };
    }
    const sensitiveHeaders = {
      authorization: "redacted",
      cookie: "redacted=true",
      "proxy-authorization": "redacted",
      "x-agent-key": "redacted",
      "x-custom-credential": "redacted"
    };
    const results = {
      healthz: await request("/healthz"),
      index: await request("/"),
      env: await request("/env-config.js"),
      live: await request("/status-api/health/live", { headers: sensitiveHeaders }),
      ready: await request("/status-api/health/ready", { headers: sensitiveHeaders }),
      query: await request("/status-api/health/live?target=/agent/heartbeat", { headers: sensitiveHeaders }),
      unknown: await request("/status-api/health/not-real"),
      post: await request("/status-api/health/live", { method: "POST", body: "mutate=true", headers: sensitiveHeaders }),
      duplicateSlash: await request("/status-api//health/live"),
      suffix: await request("/status-api/health/live/extra"),
      encodedTraversal: await request("/status-api/health/%2e%2e/ready")
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

function sentinelRecords() {
  const result = docker([
    "exec",
    sentinelName,
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

        response.setHeader("Content-Type", "application/json");
        if (parsed.pathname === "/health/live") {
          response.setHeader("Set-Cookie", "session=redacted");
          response.end(JSON.stringify({ status: "live" }));
          return;
        }

        if (parsed.pathname === "/health/ready") {
          response.statusCode = 503;
          response.setHeader("WWW-Authenticate", "Bearer realm=redacted");
          response.end(JSON.stringify({
            status: "not_ready",
            dependencies: { postgres: "up", redis: "down", tenantAuth: "up" }
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
