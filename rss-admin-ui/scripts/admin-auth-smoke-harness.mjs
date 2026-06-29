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
  const disabledServer = await startServer({ enabled: false });
  try {
    const disabled = await runSmoke([], {
      ADMIN_AUTH_SMOKE_BASE_URL: disabledServer.baseUrl,
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp
    });
    assert(disabled.status === 0, "disabled session classification should exit 0");
    assert(disabled.json?.status === "AUTH_NOT_CONFIGURED_RESIDUAL", "disabled classification mismatch");
    assert(disabled.json?.temp_cookie_jar_deleted === true, "disabled temp cookie jar was not deleted");
    assertSanitized(disabled.combinedOutput);
  } finally {
    await disabledServer.close();
  }

  const enabledServer = await startServer({ enabled: true });
  try {
    const receiptFile = path.join(harnessTmp, "receipt.json");
    const login = await runSmoke(["--login-smoke", "--receipt-file", receiptFile], {
      ADMIN_AUTH_SMOKE_BASE_URL: enabledServer.baseUrl,
      ADMIN_AUTH_SMOKE_TMP_DIR: harnessTmp,
      ADMIN_AUTH_SMOKE_USERNAME: "admin",
      ADMIN_AUTH_SMOKE_PASSWORD: syntheticPassword
    });
    assert(login.status === 0, "login smoke should exit 0");
    assert(login.json?.status === "LOGOUT_ACCEPTED_SESSION_CLEARED", "login smoke classification mismatch");
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

  const missingCredentialsServer = await startServer({ enabled: true });
  try {
    const missingCredentials = await runSmoke(["--login-smoke"], {
      ADMIN_AUTH_SMOKE_BASE_URL: missingCredentialsServer.baseUrl,
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

function startServer({ enabled }) {
  const sessions = new Set();
  const server = createServer((request, response) => {
    emitCorsHeaders(response);
    response.setHeader("Content-Type", "application/json");
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");

    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      if (parsed.pathname === "/admin-auth/session" && request.method === "GET") {
        if (!enabled) {
          response.statusCode = 501;
          response.end(JSON.stringify({
            configured: false,
            authenticated: false,
            status: "not_configured",
            reason: "not_configured"
          }));
          return;
        }

        const authenticated = (request.headers.cookie ?? "").includes(`${syntheticCookie}=present`);
        response.end(JSON.stringify({
          configured: true,
          authenticated,
          reason: authenticated ? "authenticated" : "unauthenticated"
        }));
        return;
      }

      if (parsed.pathname === "/admin-auth/login" && request.method === "POST") {
        if (!enabled) {
          response.statusCode = 501;
          response.end(JSON.stringify({ configured: false, authenticated: false, reason: "not_configured" }));
          return;
        }

        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {}

        if (body.username !== "admin" || body.password !== syntheticPassword) {
          response.statusCode = 401;
          response.end(JSON.stringify({ configured: true, authenticated: false, reason: "invalid_credentials" }));
          return;
        }

        sessions.add("present");
        response.setHeader(
          "Set-Cookie",
          `${syntheticCookie}=present; HttpOnly; Secure; Path=/admin-auth; SameSite=Lax`
        );
        response.end(JSON.stringify({ configured: true, authenticated: true }));
        return;
      }

      if (parsed.pathname === "/admin-auth/logout" && request.method === "POST") {
        sessions.clear();
        response.setHeader(
          "Set-Cookie",
          `${syntheticCookie}=; HttpOnly; Secure; Path=/admin-auth; SameSite=Lax; Max-Age=0`
        );
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
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
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
