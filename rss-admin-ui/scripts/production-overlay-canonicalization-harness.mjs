import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const taskTmp = process.env.MS024C_TASK_TMP ?? path.resolve(repoRoot, "..", "tmp");
const harnessTmp = path.join(taskTmp, "production-overlay-canonicalization");
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? "rss-admin-ui:ms024c-local";
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms024c-overlay-${suffix}`;
const frontendName = `rss-admin-ui-ms024c-frontend-${suffix}`;
const backendName = `rss-admin-ui-ms024c-backend-${suffix}`;

await rm(harnessTmp, { recursive: true, force: true });
await mkdir(harnessTmp, { recursive: true });

try {
  const helperOverlay = assertHelperIncludesOverlay();
  const helperBlock = assertHelperBlocksMissingNetwork();
  assertPlainComposeInspection();
  assertBrowserSurface();
  assertPublicEdgeAndLoopbackProtections();
  const authResidual = await assertAuthResidualDiagnostics();
  const runtime = await assertRuntimeScenarios();

  console.log(
    JSON.stringify(
      {
        status: "production-overlay-canonicalization-harness-ok",
        helper_overlay: helperOverlay,
        helper_missing_network_block: helperBlock,
        plain_compose_inspection_without_env: true,
        service_dns_without_backend_network: runtime.no_network,
        service_dns_with_backend_network: runtime.with_network,
        auth_residual_diagnostics: authResidual,
        browser_static_secret_leak: false,
        public_edge_and_loopback_protections: true,
        production_contact: false,
        output: "redacted"
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", frontendName], { allowFailure: true });
  docker(["rm", "-f", backendName], { allowFailure: true });
  docker(["network", "rm", network], { allowFailure: true });
  await rm(harnessTmp, { recursive: true, force: true });
}

function assertHelperIncludesOverlay() {
  const result = runNode(["scripts/production-compose-ops.mjs", "config", "--dry-run"], {
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_BACKEND_DOCKER_NETWORK: "main-service-production_default"
  });
  assert(result.status === 0, `helper overlay dry-run failed: ${result.stderr}`);
  const json = parseJson(result.stdout, "helper overlay dry-run");
  assert(json.backend_network_overlay === true, "helper did not include backend-network overlay");
  assert(json.compose_files.includes(path.join("deploy", "production", "compose.backend-network.yaml")), "overlay compose file missing from helper summary");
  assert(json.upstream_topology === "service_dns", "helper did not classify service DNS upstreams");
  assertSanitized(result.stdout + result.stderr);
  return { compose_files: json.compose_files, upstream_topology: json.upstream_topology };
}

function assertHelperBlocksMissingNetwork() {
  const result = runNode(["scripts/production-compose-ops.mjs", "recreate", "--dry-run"], {
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000"
  });
  assert(result.status === 1, `helper missing-network preflight should fail, got ${result.status}`);
  const json = parseJson(result.stdout, "helper missing-network dry-run");
  assert(json.status === "frontend-production-compose-command-blocked", "helper missing-network status mismatch");
  assert(json.reason === "backend_network_required_for_service_dns", "helper missing-network reason mismatch");
  assert(json.required_env === "ADMIN_UI_BACKEND_DOCKER_NETWORK", "helper missing required env guidance");
  assert(json.service_dns_upstreams.includes("ADMIN_UI_HEALTH_UPSTREAM_ORIGIN"), "helper did not identify health service-DNS upstream");
  assert(!/main-service-api:3000|rss\.habersoft\.com|rss-panel\.habersoft\.com/iu.test(result.stdout), "helper printed raw upstream or production host");
  assertSanitized(result.stdout + result.stderr);
  return { reason: json.reason, required_env: json.required_env };
}

function assertPlainComposeInspection() {
  const result = docker(["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"]);
  assert(result.status === 0, "plain production compose inspection failed without env file");
}

async function assertRuntimeScenarios() {
  ensureImage();
  docker(["network", "create", network]);

  const noNetwork = await withFrontend(
    "service-dns-no-backend-network",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000" },
    async () => {
      const healthz = runFrontendRequest("/healthz");
      assert(healthz.status === 200 && healthz.body.trim() === "ok", "no-network /healthz failed");
      const envConfig = runFrontendRequest("/env-config.js");
      assert(envConfig.status === 200, "no-network env-config.js failed");
      assert(!/main-service-api|ADMIN_UI_HEALTH_UPSTREAM_ORIGIN/u.test(envConfig.body), "no-network env-config leaked upstream");
      const live = runFrontendRequest("/status-api/health/live");
      assert(live.status === 502, `no-network live status expected 502, got ${live.status}`);
      assert(live.json?.reason === "upstream_unavailable" || live.json?.reason === "upstream_dns_unresolved", "no-network live reason mismatch");
      assert(!/main-service-api|host not found|nginx|Bad Gateway/iu.test(live.body), "no-network live leaked raw DNS/proxy diagnostic");
      return { healthz: 200, status_api: 502, reason: live.json.reason };
    }
  );

  startBackend();
  await waitForContainerHttp(backendName, "http://127.0.0.1:3100/__records");

  const withNetwork = await withFrontend(
    "service-dns-with-backend-network",
    { ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3100" },
    async () => {
      const healthz = runFrontendRequest("/healthz");
      assert(healthz.status === 200 && healthz.body.trim() === "ok", "with-network /healthz failed");
      const live = runFrontendRequest("/status-api/health/live");
      const ready = runFrontendRequest("/status-api/health/ready");
      assert(live.status === 200 && live.json?.status === "live", "with-network live failed");
      assert(ready.status === 200 && ready.json?.status === "ready", "with-network ready failed");
      assert(ready.json?.dependencies?.postgres === "up", "with-network ready postgres mismatch");
      assert(ready.headers.setCookie === null && ready.headers.wwwAuthenticate === null, "with-network leaked upstream sensitive headers");
      return { live: 200, ready: 200 };
    }
  );

  return {
    no_network: noNetwork,
    with_network: withNetwork
  };
}

function startBackend() {
  docker([
    "run",
    "-d",
    "--name",
    backendName,
    "--network",
    network,
    "--network-alias",
    "main-service-api",
    "node:24-alpine",
    "node",
    "-e",
    backendProgram()
  ]);
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
  const result = await callback();
  docker(["rm", "-f", frontendName], { allowFailure: true });
  return result;
}

function runFrontendRequest(pathname) {
  return runJsonInNetwork(`
    const response = await fetch("http://frontend:8080${pathname}", { redirect: "manual" });
    const body = await response.text();
    let json = null;
    try { json = JSON.parse(body); } catch {}
    console.log(JSON.stringify({
      status: response.status,
      body,
      json,
      headers: {
        cacheControl: response.headers.get("cache-control"),
        setCookie: response.headers.get("set-cookie"),
        wwwAuthenticate: response.headers.get("www-authenticate")
      }
    }));
  `);
}

async function assertAuthResidualDiagnostics() {
  const server = await startAuthResidualServer();
  try {
    const result = await runNodeAsync(["scripts/admin-auth-smoke.mjs", "--endpoint", server.baseUrl], {
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp,
      ADMIN_AUTH_SMOKE_TIMEOUT_MS: "2000"
    });
    assert(result.status === 2, `auth residual smoke exit mismatch: ${result.status}`);
    const json = parseJson(result.stdout, "auth residual smoke");
    assert(json.status === "AUTH_NOT_CONFIGURED_RESIDUAL", "auth residual classification mismatch");
    for (const diagnosticClass of [
      "backend_admin_auth_mode_disabled_or_missing",
      "backend_admin_username_missing_or_placeholder",
      "backend_password_hash_missing_placeholder_or_invalid",
      "backend_session_secret_missing_or_weak",
      "backend_redis_or_session_dependency_unreachable",
      "frontend_proxy_reachable_backend_auth_endpoint_reports_not_configured"
    ]) {
      assert(json.diagnostic_classes.includes(diagnosticClass), `auth residual missing diagnostic class ${diagnosticClass}`);
    }
    assert(json.next_steps.some((step) => /admin-auth config verifier/iu.test(step)), "auth residual missing backend verifier next step");
    assert(json.next_steps.some((step) => /backend API\/worker/iu.test(step)), "auth residual missing backend recreate next step");
    assert(json.next_steps.some((step) => /ops:compose:recreate/iu.test(step)), "auth residual missing canonical frontend helper next step");
    assertSanitized(result.stdout + result.stderr);
    return { classification: json.status, diagnostic_classes: json.diagnostic_classes.length };
  } finally {
    await server.close();
  }
}

function startAuthResidualServer() {
  const server = createServer((request, response) => {
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
    if (parsed.pathname === "/healthz") {
      response.setHeader("Content-Type", "text/plain");
      response.end("ok\n");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (parsed.pathname === "/status-api/health/ready") {
      response.end(JSON.stringify({ status: "ready", dependencies: { postgres: "up", redis: "up", tenantAuth: "up" } }));
      return;
    }
    if (parsed.pathname === "/admin-auth/session") {
      response.statusCode = 501;
      response.end(JSON.stringify({ configured: false, authenticated: false, status: "not_configured", reason: "not_configured" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ status: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("auth residual server did not expose a TCP address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      });
    });
  });
}

function assertBrowserSurface() {
  const files = [
    ...collectFiles(path.join(frontendRoot, "src")),
    ...collectFiles(path.join(frontendRoot, "public")),
    path.join(frontendRoot, "index.html"),
    ...collectFiles(path.join(frontendRoot, "dist"))
  ].filter((file) => existsSync(file) && statSync(file).isFile() && /\.(ts|tsx|js|mjs|html|css|json)$/iu.test(file));

  const forbidden = [
    /ADMIN_UI_(?:HEALTH|AUTH)_UPSTREAM_ORIGIN/u,
    /rss(?:-panel)?\.habersoft\.com/iu,
    /main-service-api:3000|host\.docker\.internal:3200|127\.0\.0\.1:3200/iu,
    /ADMIN_UI_ADMIN_PASSWORD|ADMIN_UI_ADMIN_PASSWORD_HASH|ADMIN_UI_SESSION_SECRET/u,
    /AGENT_KEY|X-Agent-Key|TENANT_AUTH|DATABASE_URL|REDIS_URL/u,
    /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u
  ];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert(!pattern.test(text), `forbidden browser/static surface in ${path.relative(frontendRoot, file)}`);
    }
  }
}

function assertPublicEdgeAndLoopbackProtections() {
  const entrypoint = readFileSync(path.join(frontendRoot, "docker-entrypoint.sh"), "utf8");
  for (const fragment of [
    "public_edge_upstream_rejected",
    "rss.habersoft.com",
    "rss-panel.habersoft.com",
    "container-local or unspecified loopback host",
    "127.*|0.0.0.0|0.0.0.0.|0|::|::1",
    "invalid_upstream_origin"
  ]) {
    assert(entrypoint.includes(fragment), `entrypoint missing upstream protection fragment: ${fragment}`);
  }
}

function backendProgram() {
  return String.raw`
    const http = require("node:http");
    const records = [];
    const server = http.createServer((request, response) => {
      const parsed = new URL(request.url, "http://main-service-api");
      if (parsed.pathname === "/__records") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(records));
        return;
      }
      records.push({ method: request.method, path: parsed.pathname });
      response.setHeader("Set-Cookie", "upstream=redacted; HttpOnly");
      response.setHeader("WWW-Authenticate", "Bearer realm=redacted");
      response.setHeader("Content-Type", "application/json");
      if (parsed.pathname === "/health/live") {
        response.end(JSON.stringify({ status: "live" }));
        return;
      }
      if (parsed.pathname === "/health/ready") {
        response.end(JSON.stringify({ status: "ready", dependencies: { postgres: "up", redis: "up", tenantAuth: "up" } }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ status: "not_found" }));
    });
    server.listen(3100, "0.0.0.0");
  `;
}

function ensureImage() {
  const inspected = docker(["image", "inspect", image], { allowFailure: true });
  if (inspected.status === 0) return;
  if (image !== "rss-admin-ui:ms024c-local") {
    throw new Error(`Docker image is not available: ${image}`);
  }
  docker(["build", "-t", image, "."], { timeoutMs: 600000 });
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
        "fetch('http://frontend:8080/healthz').then((r)=>process.exit(r.ok ? 0 : 1)).catch(()=>process.exit(1));"
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
    const result = docker(["exec", container, "node", "-e", `fetch('${url}').then((r)=>process.exit(r.ok ? 0 : 1)).catch(()=>process.exit(1));`], {
      allowFailure: true,
      timeoutMs: 30000
    });
    if (result.status === 0) return;
    await sleep(1000);
  }
  throw new Error(`${container} did not become healthy`);
}

function runJsonInNetwork(program) {
  const result = docker(["run", "--rm", "--network", network, "node:24-alpine", "node", "-e", program], {
    timeoutMs: 120000
  });
  return parseJson(result.stdout, "docker network json");
}

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: frontendRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });
}

function runNodeAsync(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: frontendRoot,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`node ${args.join(" ")} timed out`));
    }, 120000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
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

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not emit JSON: ${text}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSanitized(text) {
  assert(!/set-cookie\s*:|opaque-ms024c-cookie|synthetic-ms024c-password|ADMIN_UI_ADMIN_PASSWORD_HASH=|ADMIN_UI_SESSION_SECRET=/iu.test(text), "unsafe diagnostic output leaked");
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
