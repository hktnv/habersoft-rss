import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const projectName = `habersoft-rss-ms020c-${Date.now()}`;
const uiPort = await freePort();
const apiPort = await freePort();

const composeEnv = {
  ...process.env,
  POSTGRES_USER: "main_service",
  POSTGRES_PASSWORD: "main_service_local_password",
  POSTGRES_DB: "main_service",
  DATABASE_URL: "postgresql://main_service:main_service_local_password@postgres:5432/main_service?schema=public",
  ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
  ADMIN_UI_ENVIRONMENT_NAME: "local-fullstack-rehearsal",
  ADMIN_UI_HOST_PORT: String(uiPort),
  API_HOST_PORT: String(apiPort)
};

let primaryFailure;

try {
  compose(["config", "--quiet"], { timeoutMs: 120000 });
  compose(["up", "-d", "--build", "--wait", "--wait-timeout", "360"], { timeoutMs: 900000 });

  const base = `http://127.0.0.1:${uiPort}`;
  const healthz = await requestText(`${base}/healthz`);
  assert(healthz.status === 200 && healthz.body.trim() === "ok", "frontend /healthz failed");

  const index = await requestText(`${base}/`);
  assert(index.status === 200 && index.body.includes("Habersoft RSS Admin"), "static app failed");

  const envConfig = await requestText(`${base}/env-config.js`);
  assert(envConfig.status === 200, "env-config.js failed");
  assert(!envConfig.body.includes("main-service-api:3000"), "server-only upstream leaked into env-config.js");

  const live = await requestJson(`${base}/status-api/health/live`);
  assert(live.status === 200 && live.body.status === "live", "live health did not reach the local backend");

  const ready = await waitForReady(`${base}/status-api/health/ready`);
  assert(ready.body.status === "ready", "ready health did not report ready");
  assert(ready.body.dependencies.postgres === "up", "PostgreSQL readiness was not up");
  assert(ready.body.dependencies.redis === "up", "Redis readiness was not up");
  assert(ready.body.dependencies.tenantAuth === "up", "Tenant auth readiness was not up");

  const unknown = await requestText(`${base}/status-api/agent/heartbeat`);
  assert(unknown.status === 404, "unknown backend-like status path was not rejected");

  const write = await requestText(`${base}/status-api/health/live`, {
    method: "POST",
    body: "mutate=true"
  });
  assert(write.status === 405, "write method reached the health transport");

  console.log(
    JSON.stringify(
      {
        status: "root-fullstack-acceptance-ok",
        project: projectName,
        ui_origin: base,
        api_loopback_port: apiPort,
        readiness: ready.body.dependencies
      },
      null,
      2
    )
  );
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const cleanup = compose(["down", "--volumes", "--remove-orphans"], { allowFailure: true, timeoutMs: 240000 });
  const leftovers = inspectLeftovers();
  if (cleanup.status !== 0 || leftovers !== "") {
    const cleanupError = new Error(
      `root full-stack cleanup failed\ncompose down status: ${cleanup.status}\nleftovers:\n${leftovers}\nstderr:\n${cleanup.stderr}`
    );
    if (primaryFailure === undefined) throw cleanupError;
    console.error(cleanupError.message);
  }
}

async function waitForReady(url) {
  let last;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await requestJson(url);
    if (last.status === 200 && last.body?.status === "ready") return last;
    await sleep(2000);
  }
  throw new Error(`ready health did not become ready; last status ${last?.status ?? "none"}`);
}

async function requestText(url, init) {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: await response.text()
  };
}

async function requestJson(url) {
  const response = await fetch(url);
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return {
    status: response.status,
    body
  };
}

function compose(args, options = {}) {
  return run(["compose", "-p", projectName, ...args], {
    cwd: repoRoot,
    env: composeEnv,
    timeoutMs: options.timeoutMs,
    allowFailure: options.allowFailure
  });
}

function inspectLeftovers() {
  const filters = [`label=com.docker.compose.project=${projectName}`];
  const containers = run(["ps", "-a", "--filter", filters[0], "--format", "{{.ID}}"], { cwd: repoRoot, allowFailure: true });
  const networks = run(["network", "ls", "--filter", filters[0], "--format", "{{.ID}}"], {
    cwd: repoRoot,
    allowFailure: true
  });
  const volumes = run(["volume", "ls", "--filter", filters[0], "--format", "{{.Name}}"], {
    cwd: repoRoot,
    allowFailure: true
  });
  return [containers.stdout, networks.stdout, volumes.stdout].join("").trim();
}

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("could not allocate a free local port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
