import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms023d-local";
const image = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms023d-sentinel-${suffix}`;
const recorderName = `rss-admin-ui-ms023d-recorder-${suffix}`;
const frontendName = `rss-admin-ui-ms023d-runtime-${suffix}`;

try {
  ensureImage();
  docker(["network", "create", network]);
  docker([
    "run",
    "-d",
    "--name",
    recorderName,
    "--network",
    network,
    "--network-alias",
    "sentinel",
    "node:24-alpine",
    "node",
    "-e",
    recorderProgram()
  ]);
  await waitForContainerHttp(recorderName, "http://127.0.0.1:3100/__records");
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
    "ADMIN_UI_ENVIRONMENT_NAME=auth-session-sentinel-harness",
    image
  ]);
  await waitForFrontend();
  docker(["exec", frontendName, "nginx", "-t"]);

  const results = runFrontendRequests();
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "frontend /healthz failed");

  assert(results.session.status === 501, "session sentinel did not return 501");
  assert(results.session.json?.status === "not_configured", "session sentinel status mismatch");
  assert(results.session.json?.authenticated === false, "session sentinel must be unauthenticated");
  assert(results.session.json?.message === "Admin authentication is not configured.", "session sentinel message mismatch");
  assert(/application\/json/iu.test(results.session.headers.contentType ?? ""), "session sentinel is not JSON");

  assert(results.sessionQuery.status === 501, "session query sentinel did not remain fail-closed");
  assert(!results.sessionQuery.body.includes("example"), "session query token was reflected");
  assert(results.sessionQuery.body === results.session.body, "session query changed sentinel body");
  assert(results.postSession.status === 405, "non-GET session request was not rejected");
  assert(results.getLogin.status === 405, "non-POST login request was not rejected");
  assert(results.postLogin.status === 503, "static login did not remain fail-closed");
  assert(results.getLogout.status === 405, "non-POST logout request was not rejected");
  assert(results.postLogout.status === 501, "static logout did not remain fail-closed");
  assert(results.unknown.status === 404, "unknown admin-auth path was not rejected");
  assert(!results.unknown.body.includes("Habersoft RSS Admin"), "unknown admin-auth path fell back to the SPA");
  assert(results.assets.length > 0, "no static JS/CSS assets were checked");
  for (const [label, result] of Object.entries({
    session: results.session,
    sessionQuery: results.sessionQuery,
    postSession: results.postSession,
    getLogin: results.getLogin,
    postLogin: results.postLogin,
    getLogout: results.getLogout,
    postLogout: results.postLogout,
    unknown: results.unknown
  })) {
    assert(/no-store/iu.test(result.headers.cacheControl ?? ""), `${label} response is cacheable`);
    assert(result.headers.setCookie === null, `${label} response emitted Set-Cookie`);
    assert(result.headers.wwwAuthenticate === null, `${label} response emitted WWW-Authenticate`);
  }

  const staticSurface = [results.index.body, results.env.body, ...results.assets.map((asset) => asset.body)].join("\n");
  assert(!staticSurface.includes("ADMIN_UI_API_BASE_URL"), "legacy browser API base leaked to static surface");
  assert(!staticSurface.includes("ADMIN_UI_HEALTH_UPSTREAM_ORIGIN"), "server upstream env leaked to static surface");
  assert(!staticSurface.includes("sentinel:3100"), "synthetic upstream leaked to static surface");
  assert(!/AGENT_KEY|X-Agent-Key|DATABASE_URL|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY/iu.test(staticSurface), "secret-like string leaked to static surface");
  assert(!/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/u.test(staticSurface), "browser persistence string leaked to static surface");

  const records = recorderRecords();
  assert(records.length === 0, `admin-auth route reached upstream recorder ${records.length} time(s)`);

  console.log(
    JSON.stringify(
      {
        status: "auth-session-sentinel-harness-ok",
        image,
        network,
        path: "/admin-auth/session",
        get_status: results.session.status,
      post_status: results.postSession.status,
      login_post_status: results.postLogin.status,
      logout_post_status: results.postLogout.status,
      unknown_status: results.unknown.status,
        upstream_records: records.length,
        static_assets_checked: results.assets.length
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", frontendName], { allowFailure: true });
  docker(["rm", "-f", recorderName], { allowFailure: true });
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
      cookie: "redacted=true",
      "proxy-authorization": "redacted",
      "x-agent-key": "redacted",
      "x-custom-credential": "redacted"
    };
    const index = await request("/");
    const assetPaths = [...index.body.matchAll(/(?:src|href)="([^"]+\\.(?:js|css))"/g)].map((match) => match[1]);
    const results = {
      healthz: await request("/healthz"),
      index,
      env: await request("/env-config.js"),
      assets: await Promise.all(assetPaths.map((assetPath) => request(assetPath))),
      session: await request("/admin-auth/session", { headers: sensitiveHeaders }),
      sessionQuery: await request("/admin-auth/session?token=example", { headers: sensitiveHeaders }),
      postSession: await request("/admin-auth/session", { method: "POST", body: "mutate=true", headers: sensitiveHeaders }),
      getLogin: await request("/admin-auth/login", { headers: sensitiveHeaders }),
      postLogin: await request("/admin-auth/login", { method: "POST", body: "{}", headers: sensitiveHeaders }),
      getLogout: await request("/admin-auth/logout", { headers: sensitiveHeaders }),
      postLogout: await request("/admin-auth/logout", { method: "POST", headers: sensitiveHeaders }),
      unknown: await request("/admin-auth/unknown", { headers: sensitiveHeaders })
    };
    console.log(JSON.stringify(results));
  `);
}

function recorderRecords() {
  const result = docker([
    "exec",
    recorderName,
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

function recorderProgram() {
  return String.raw`
    const http = require("node:http");
    const records = [];
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
        records.push({
          method: request.method,
          path: parsed.pathname,
          search: parsed.search,
          bodyPresent: Buffer.concat(chunks).length > 0,
          headers: request.headers
        });
        response.setHeader("Content-Type", "application/json");
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
