import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(frontendRoot, "scripts", "admin-auth-smoke.mjs");
const taskTmp = process.env.MS024A_TASK_TMP ?? path.resolve(frontendRoot, "..", "..", "tmp");
const harnessTmp = path.join(taskTmp, "admin-auth-smoke-harness");
const syntheticPassword = "synthetic-ms024a-password";
const syntheticCookie = "opaque-ms024a-cookie";

await rm(harnessTmp, { recursive: true, force: true });
await mkdir(harnessTmp, { recursive: true });

try {
  await assertEndpointDownClassification();
  await assertServerClassification("healthz-unavailable", { mode: "healthz-unavailable" }, {}, "HEALTHZ_UNAVAILABLE", 2);
  await assertServerClassification("status-api-misconfigured", { mode: "status-api-misconfigured" }, {}, "STATUS_API_UPSTREAM_MISCONFIGURED", 2);
  await assertServerClassification("auth-upstream-misconfigured", { mode: "auth-upstream-misconfigured" }, {}, "ADMIN_AUTH_UPSTREAM_MISCONFIGURED", 2);
  await assertServerClassification("disabled", { mode: "disabled" }, {}, "AUTH_NOT_CONFIGURED_RESIDUAL", 2);

  await assertServerClassification(
    "invalid-credentials",
    { mode: "enabled" },
    { ADMIN_AUTH_SMOKE_USERNAME: "admin", ADMIN_AUTH_SMOKE_PASSWORD: "wrong-synthetic-password" },
    "INVALID_CREDENTIALS",
    2
  );
  await assertServerClassification(
    "missing-cookie",
    { mode: "missing-cookie" },
    { ADMIN_AUTH_SMOKE_USERNAME: "admin", ADMIN_AUTH_SMOKE_PASSWORD: syntheticPassword },
    "COOKIE_NOT_ESTABLISHED",
    2
  );
  await assertServerClassification(
    "session-after-login-false",
    { mode: "session-after-login-false" },
    { ADMIN_AUTH_SMOKE_USERNAME: "admin", ADMIN_AUTH_SMOKE_PASSWORD: syntheticPassword },
    "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
    2
  );
  await assertServerClassification(
    "logout-failed",
    { mode: "logout-failed" },
    { ADMIN_AUTH_SMOKE_USERNAME: "admin", ADMIN_AUTH_SMOKE_PASSWORD: syntheticPassword },
    "LOGOUT_FAILED",
    2
  );

  const enabledServer = await startServer({ mode: "enabled" });
  try {
    const receiptFile = path.join(harnessTmp, "receipt.json");
    const login = await runSmoke(["--endpoint", enabledServer.baseUrl, "--receipt-file", receiptFile], {
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp,
      ADMIN_AUTH_SMOKE_USERNAME: "admin",
      ADMIN_AUTH_SMOKE_PASSWORD: syntheticPassword
    });
    assert(login.status === 0, "login smoke should exit 0");
    assert(login.json?.status === "LOGOUT_ACCEPTED_SESSION_CLEARED", "login smoke classification mismatch");
    assert(login.json?.mode === "login-smoke", "credential-present smoke should auto-enable login mode");
    assert(login.json?.cookie?.login_set_cookie === "present", "login smoke did not report Set-Cookie presence");
    assert(login.json?.cookie?.http_only === true, "login smoke did not prove HttpOnly");
    assert(login.json?.cookie?.same_site_lax === true, "login smoke did not prove SameSite=Lax");
    assert(login.json?.cookie?.path_admin_auth === true, "login smoke did not prove /admin-auth path");
    assert(login.json?.temp_cookie_jar_deleted === true, "login temp cookie jar was not deleted");
    assertSanitized(login.combinedOutput);
    const receipt = await readFile(receiptFile, "utf8");
    assertSanitized(receipt);
    assert(JSON.parse(receipt).status === "LOGOUT_ACCEPTED_SESSION_CLEARED", "receipt classification mismatch");
  } finally {
    await enabledServer.close();
  }

  const missingCredentialsServer = await startServer({ mode: "enabled" });
  try {
    const missingCredentials = await runSmoke(["--endpoint", missingCredentialsServer.baseUrl, "--login-smoke"], {
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp
    });
    assert(missingCredentials.status !== 0, "login smoke without credentials should fail");
    assert(missingCredentials.combinedOutput.includes("ADMIN_AUTH_SMOKE_USERNAME"), "missing credential guidance mismatch");
    assertSanitized(missingCredentials.combinedOutput);
  } finally {
    await missingCredentialsServer.close();
  }

  const leftovers = (await readdir(harnessTmp)).filter((entry) => entry.startsWith("rss-admin-auth-smoke-"));
  assert(leftovers.length === 0, `temporary cookie jars remained: ${leftovers.join(", ")}`);

  console.log(
    JSON.stringify(
      {
        status: "admin-auth-smoke-harness-ok",
        modes: ["session-classification", "login-smoke"],
        classifications: [
          "ENDPOINT_UNREACHABLE",
          "HEALTHZ_UNAVAILABLE",
          "STATUS_API_UPSTREAM_MISCONFIGURED",
          "ADMIN_AUTH_UPSTREAM_MISCONFIGURED",
          "AUTH_NOT_CONFIGURED_RESIDUAL",
          "INVALID_CREDENTIALS",
          "COOKIE_NOT_ESTABLISHED",
          "SESSION_AFTER_LOGIN_NOT_AUTHENTICATED",
          "LOGOUT_FAILED",
          "LOGOUT_ACCEPTED_SESSION_CLEARED"
        ],
        temp_cookie_jars_removed: true,
        output: "redacted"
      },
      null,
      2
    )
  );
} finally {
  await rm(harnessTmp, { recursive: true, force: true });
}

async function assertEndpointDownClassification() {
  const port = await closedPort();
  const result = await runSmoke(["--endpoint", `http://127.0.0.1:${port}`], {
    ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp,
    ADMIN_AUTH_SMOKE_TIMEOUT_MS: "1000"
  });
  assert(result.status === 2, "endpoint-down smoke should exit 2");
  assert(result.json?.status === "ENDPOINT_UNREACHABLE", "endpoint-down classification mismatch");
  assert(result.combinedOutput.includes("frontend container may be down/restarting"), "endpoint-down next-step guidance missing");
  assertSanitized(result.combinedOutput);
}

async function assertServerClassification(label, serverOptions, env, expectedStatus, expectedExit) {
  const server = await startServer(serverOptions);
  try {
    const result = await runSmoke(["--endpoint", server.baseUrl], {
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp,
      ...env
    });
    assert(result.status === expectedExit, `${label} exit mismatch: expected ${expectedExit}, got ${result.status}`);
    assert(result.json?.status === expectedStatus, `${label} classification mismatch`);
    assert(result.json?.temp_cookie_jar_deleted === true, `${label} temp cookie jar was not deleted`);
    assert(Array.isArray(result.json?.next_steps) && result.json.next_steps.length > 0, `${label} next steps missing`);
    assertSanitized(result.combinedOutput);
  } finally {
    await server.close();
  }
}

function startServer({ mode }) {
  let authenticated = false;
  const server = createServer((request, response) => {
    emitCorsHeaders(response);
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");

    if (parsed.pathname === "/healthz" && request.method === "GET") {
      if (mode === "healthz-unavailable") {
        response.statusCode = 503;
        response.setHeader("Content-Type", "text/plain");
        response.end("unavailable");
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain");
      response.end("ok\n");
      return;
    }

    response.setHeader("Content-Type", "application/json");
    if (parsed.pathname === "/status-api/health/ready" && request.method === "GET") {
      if (mode === "status-api-misconfigured") {
        response.statusCode = 502;
        response.end(JSON.stringify({ status: "unavailable", reason: "invalid_upstream_origin" }));
        return;
      }
      response.end(JSON.stringify({ status: "ready", dependencies: { postgres: "up", redis: "up", tenantAuth: "up" } }));
      return;
    }

    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      if (parsed.pathname === "/admin-auth/session" && request.method === "GET") {
        if (mode === "disabled") {
          response.statusCode = 501;
          response.end(JSON.stringify({ configured: false, authenticated: false, status: "not_configured", reason: "not_configured" }));
          return;
        }
        if (mode === "auth-upstream-misconfigured") {
          response.statusCode = 502;
          response.end(JSON.stringify({ configured: false, authenticated: false, reason: "invalid_upstream_origin" }));
          return;
        }
        response.end(JSON.stringify({ configured: true, authenticated, reason: authenticated ? "authenticated" : "unauthenticated" }));
        return;
      }

      if (parsed.pathname === "/admin-auth/login" && request.method === "POST") {
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {}

        if (body.username !== "admin" || body.password !== syntheticPassword) {
          response.statusCode = 401;
          response.end(JSON.stringify({ configured: true, authenticated: false, reason: "invalid_credentials" }));
          return;
        }

        authenticated = mode !== "session-after-login-false";
        if (mode !== "missing-cookie") {
          response.setHeader("Set-Cookie", `${syntheticCookie}=present; HttpOnly; Secure; Path=/admin-auth; SameSite=Lax`);
        }
        response.end(JSON.stringify({ configured: true, authenticated: true }));
        return;
      }

      if (parsed.pathname === "/admin-auth/logout" && request.method === "POST") {
        if (mode === "logout-failed") {
          response.statusCode = 500;
          response.end(JSON.stringify({ configured: true, authenticated: true, reason: "auth_unavailable" }));
          return;
        }
        authenticated = false;
        response.setHeader("Set-Cookie", `${syntheticCookie}=; HttpOnly; Secure; Path=/admin-auth; SameSite=Lax; Max-Age=0`);
        response.end(JSON.stringify({ configured: true, authenticated: false, reason: "logged_out" }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ status: "not_found" }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("synthetic auth server did not expose a TCP address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve))
      });
    });
  });
}

function closedPort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        reject(new Error("temporary server did not expose a TCP address"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function emitCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "https://evil.invalid");
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "authorization,cookie,x-agent-key");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
  response.setHeader("Access-Control-Expose-Headers", "set-cookie,www-authenticate");
  response.setHeader("Access-Control-Max-Age", "86400");
}

function runSmoke(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: frontendRoot,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (status) => {
      let json = null;
      try {
        json = stdout.trim() === "" ? null : JSON.parse(stdout);
      } catch {}
      resolve({ status, stdout, stderr, combinedOutput: `${stdout}\n${stderr}`, json });
    });
  });
}

function assertSanitized(text) {
  assert(!text.includes(syntheticPassword), "synthetic password leaked");
  assert(!text.includes(syntheticCookie), "synthetic cookie leaked");
  assert(!/set-cookie\s*:/iu.test(text), "raw Set-Cookie header leaked");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
