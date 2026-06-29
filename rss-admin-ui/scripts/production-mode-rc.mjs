import { pbkdf2Sync } from "node:crypto";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const stamp = Date.now();
const frontendImage = process.env.RSS_ADMIN_UI_TEST_IMAGE ?? "rss-admin-ui:ms023d-local";
const backendImage = process.env.RSS_HABERSOFT_COM_TEST_IMAGE ?? "main-service-app:ms023d-rc-local";
const adminUsername = "admin";
const adminPassword = "synthetic-ms023d-admin-password";
const adminPasswordHash = hashAdminPassword(adminPassword, Buffer.from("ms023d-rc-salt-00", "utf8"));
const adminSessionSecret = "synthetic_ms023d_admin_session_secret_48_bytes_minimum";
const scenarioResults = [];

await runDisabledScenario();
await runEnabledScenario();
assertNoGlobalLeftovers();

console.log(
  JSON.stringify(
    {
      status: "production-mode-operator-package-rc-ok",
      frontend_image: frontendImage,
      backend_image: backendImage,
      scenarios: scenarioResults,
      production_contact: false,
      registry_publication: false
    },
    null,
    2
  )
);

async function runDisabledScenario() {
  const projectName = `habersoft-rss-ms023d-disabled-${stamp}`;
  const uiPort = await freePort();
  const apiPort = await freePort();
  const env = composeEnv({
    uiPort,
    apiPort,
    authMode: "disabled",
    authValues: {
      ADMIN_UI_ADMIN_USERNAME: "",
      ADMIN_UI_ADMIN_PASSWORD_HASH: "",
      ADMIN_UI_SESSION_SECRET: ""
    }
  });

  await withCompose(projectName, env, async () => {
    const base = `http://127.0.0.1:${uiPort}`;
    const healthz = await requestText(`${base}/healthz`);
    assert(healthz.status === 200 && healthz.body.trim() === "ok", "disabled scenario frontend /healthz failed");

    const session = await requestJson(`${base}/admin-auth/session`);
    assert(session.status === 501, "disabled admin auth session did not fail closed");
    assert(session.body?.configured === false, "disabled admin auth session reported configured");
    assert(session.headers.setCookie === null, "disabled admin auth session emitted a cookie");

    const login = await requestJson(`${base}/admin-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: adminPassword })
    });
    assert(login.status === 503, "disabled admin auth login did not fail closed");
    assert(login.headers.setCookie === null, "disabled admin auth login emitted a cookie");

    const live = await requestJson(`${base}/status-api/health/live`);
    assert(live.status === 200 && live.body?.status === "live", "disabled scenario health proxy failed");

    scenarioResults.push({
      name: "disabled-default",
      session_status: session.status,
      login_status: login.status,
      health_live: live.body?.status
    });
  });
}

async function runEnabledScenario() {
  const projectName = `habersoft-rss-ms023d-enabled-${stamp}`;
  const uiPort = await freePort();
  const apiPort = await freePort();
  const env = composeEnv({
    uiPort,
    apiPort,
    authMode: "single_admin",
    authValues: {
      ADMIN_UI_ADMIN_USERNAME: adminUsername,
      ADMIN_UI_ADMIN_PASSWORD_HASH: adminPasswordHash,
      ADMIN_UI_SESSION_SECRET: adminSessionSecret
    }
  });

  await withCompose(projectName, env, async () => {
    const base = `http://127.0.0.1:${uiPort}`;
    const healthz = await requestText(`${base}/healthz`);
    assert(healthz.status === 200 && healthz.body.trim() === "ok", "enabled scenario frontend /healthz failed");

    const index = await requestText(`${base}/`);
    assert(index.status === 200 && index.body.includes("Habersoft RSS Admin"), "enabled scenario static app failed");

    const envConfig = await requestText(`${base}/env-config.js`);
    assert(envConfig.status === 200, "enabled scenario env-config.js failed");
    assert(!envConfig.body.includes("main-service-api:3000"), "auth upstream leaked into env-config.js");

    const unauthenticated = await requestJson(`${base}/admin-auth/session`);
    assert(unauthenticated.status === 200, "fresh enabled session check failed");
    assert(unauthenticated.body?.configured === true, "enabled session did not report configured");
    assert(unauthenticated.body?.authenticated === false, "fresh enabled session should be unauthenticated");
    assert(unauthenticated.headers.setCookie === null, "fresh enabled session emitted a cookie");

    const invalidLogin = await requestJson(`${base}/admin-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: "wrong-password" })
    });
    assert(invalidLogin.status === 401, "invalid login was not rejected");
    assert(invalidLogin.headers.setCookie === null, "invalid login emitted a cookie");
    assert(invalidLogin.headers.wwwAuthenticate === null, "invalid login exposed WWW-Authenticate");

    const validLogin = await requestJson(`${base}/admin-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: adminPassword })
    });
    assert(validLogin.status === 200, "valid login failed");
    assert(validLogin.body?.authenticated === true, "valid login did not authenticate");
    assert(!JSON.stringify(validLogin.body).includes(adminPassword), "login body leaked password");
    assert(!JSON.stringify(validLogin.body).includes(adminPasswordHash), "login body leaked password hash");
    assert(/HttpOnly/iu.test(validLogin.headers.setCookie ?? ""), "login cookie is not HTTP-only");
    assert(/SameSite=Lax/iu.test(validLogin.headers.setCookie ?? ""), "login cookie is not SameSite=Lax");
    assert(/Path=\/admin-auth/iu.test(validLogin.headers.setCookie ?? ""), "login cookie path mismatch");

    const sessionCookie = cookiePair(validLogin.headers.setCookie);
    assert(sessionCookie !== undefined, "login did not produce a session cookie");

    const authenticated = await requestJson(`${base}/admin-auth/session`, {
      headers: { Cookie: sessionCookie }
    });
    assert(authenticated.status === 200, "authenticated session check failed");
    assert(authenticated.body?.authenticated === true, "session did not authenticate with cookie");
    assert(authenticated.body?.principal?.kind === "single_admin", "authenticated principal mismatch");
    assert(!JSON.stringify(authenticated.body).includes(sessionCookie), "session body leaked cookie value");

    const live = await requestJson(`${base}/status-api/health/live`, {
      headers: {
        Authorization: "Bearer redacted",
        Cookie: sessionCookie,
        "X-Agent-Key": "redacted"
      }
    });
    assert(live.status === 200 && live.body?.status === "live", "live health did not reach local backend");

    const ready = await waitForReady(`${base}/status-api/health/ready`);
    assert(ready.body?.status === "ready", "ready health did not report ready");
    assert(ready.body?.dependencies?.postgres === "up", "PostgreSQL readiness was not up");
    assert(ready.body?.dependencies?.redis === "up", "Redis readiness was not up");
    assert(ready.body?.dependencies?.tenantAuth === "up", "Tenant auth readiness was not up");

    const wrongMethod = await requestText(`${base}/admin-auth/session`, {
      method: "POST",
      body: "mutate=true"
    });
    assert(wrongMethod.status === 405, "wrong auth method was not rejected");

    const unknownAuth = await requestText(`${base}/admin-auth/unknown`);
    assert(unknownAuth.status === 404, "unknown auth route was not rejected");
    assert(!unknownAuth.body.includes("Habersoft RSS Admin"), "unknown auth route fell back to the SPA");

    const unknownHealth = await requestText(`${base}/status-api/unknown`);
    assert(unknownHealth.status === 404, "unknown health route was not rejected");

    const logout = await requestJson(`${base}/admin-auth/logout`, {
      method: "POST",
      headers: { Cookie: sessionCookie }
    });
    assert(logout.status === 200, "logout failed");
    assert(logout.body?.authenticated === false, "logout did not return unauthenticated state");
    assert(/Max-Age=0/iu.test(logout.headers.setCookie ?? ""), "logout did not clear the cookie");

    const afterLogout = await requestJson(`${base}/admin-auth/session`, {
      headers: { Cookie: sessionCookie }
    });
    assert(afterLogout.status === 200, "post-logout session check failed");
    assert(afterLogout.body?.authenticated === false, "logout did not invalidate the server-side session");

    const staticSurface = [index.body, envConfig.body, ...(await staticAssets(base, index.body))].join("\n");
    assert(!staticSurface.includes(adminPassword), "admin password leaked to static surface");
    assert(!staticSurface.includes(adminPasswordHash), "admin password hash leaked to static surface");
    assert(!staticSurface.includes(adminSessionSecret), "admin session secret leaked to static surface");
    assert(!staticSurface.includes("main-service-api:3000"), "upstream origin leaked to static surface");
    assert(!/AGENT_KEY|X-Agent-Key|DATABASE_URL|BEGIN PRIVATE KEY|BEGIN RSA PRIVATE KEY/iu.test(staticSurface), "secret-like string leaked to static surface");
    assert(!/\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/u.test(staticSurface), "browser persistence string leaked to static surface");

    scenarioResults.push({
      name: "single-admin-synthetic",
      fresh_session: unauthenticated.body?.reason,
      invalid_login_status: invalidLogin.status,
      valid_login_status: validLogin.status,
      authenticated_session: authenticated.body?.authenticated,
      logout_status: logout.status,
      after_logout_authenticated: afterLogout.body?.authenticated,
      readiness: ready.body?.dependencies
    });
  });
}

function composeEnv({ uiPort, apiPort, authMode, authValues }) {
  return {
    ...process.env,
    RSS_HABERSOFT_COM_IMAGE: backendImage,
    RSS_ADMIN_UI_IMAGE: frontendImage,
    POSTGRES_USER: "main_service",
    POSTGRES_PASSWORD: "main_service_local_password",
    POSTGRES_DB: "main_service",
    DATABASE_URL: "postgresql://main_service:main_service_local_password@postgres:5432/main_service?schema=public",
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
    ADMIN_UI_AUTH_MODE: authMode,
    ADMIN_UI_SESSION_TTL_SECONDS: "900",
    ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
    ADMIN_UI_SESSION_COOKIE_SECURE: "false",
    ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:ms023d",
    ADMIN_UI_ENVIRONMENT_NAME: "local-production-mode-rc",
    ADMIN_UI_HOST_PORT: String(uiPort),
    API_HOST_PORT: String(apiPort),
    ...authValues
  };
}

async function withCompose(projectName, env, callback) {
  let primaryFailure;
  try {
    compose(projectName, ["config", "--quiet"], env, { timeoutMs: 120000 });
    compose(projectName, ["up", "-d", "--build", "--wait", "--wait-timeout", "420"], env, { timeoutMs: 900000 });
    await callback();
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanup = compose(projectName, ["down", "--volumes", "--remove-orphans"], env, {
      allowFailure: true,
      timeoutMs: 240000
    });
    const leftovers = inspectProjectLeftovers(projectName);
    if (cleanup.status !== 0 || leftovers !== "") {
      const cleanupError = new Error(
        `production-mode RC cleanup failed for ${projectName}\ncompose down status: ${cleanup.status}\nleftovers:\n${leftovers}\nstderr:\n${cleanup.stderr}`
      );
      if (primaryFailure === undefined) throw cleanupError;
      console.error(cleanupError.message);
    }
  }
}

function compose(projectName, args, env, options = {}) {
  return run(["compose", "-p", projectName, ...args], {
    cwd: repoRoot,
    env,
    timeoutMs: options.timeoutMs,
    allowFailure: options.allowFailure
  });
}

function inspectProjectLeftovers(projectName) {
  const filter = `label=com.docker.compose.project=${projectName}`;
  const containers = run(["ps", "-a", "--filter", filter, "--format", "{{.ID}}"], { allowFailure: true });
  const networks = run(["network", "ls", "--filter", filter, "--format", "{{.ID}}"], { allowFailure: true });
  const volumes = run(["volume", "ls", "--filter", filter, "--format", "{{.Name}}"], { allowFailure: true });
  return [containers.stdout, networks.stdout, volumes.stdout].join("").trim();
}

function assertNoGlobalLeftovers() {
  const pattern = "ms023d";
  const containers = run(["ps", "-a", "--format", "{{.Names}}"], { allowFailure: true });
  const networks = run(["network", "ls", "--format", "{{.Name}}"], { allowFailure: true });
  const volumes = run(["volume", "ls", "--format", "{{.Name}}"], { allowFailure: true });
  const leftovers = [containers.stdout, networks.stdout, volumes.stdout]
    .join("\n")
    .split(/\r?\n/u)
    .filter((line) => line.includes(pattern));
  assert(leftovers.length === 0, `MS-023D Docker leftovers remained: ${leftovers.join(", ")}`);
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

async function staticAssets(base, indexBody) {
  const paths = [...indexBody.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/gu)].map((match) => match[1]);
  const assets = [];
  for (const assetPath of paths) {
    const asset = await requestText(`${base}${assetPath}`);
    assert(asset.status === 200, `static asset failed: ${assetPath}`);
    assets.push(asset.body);
  }
  return assets;
}

async function requestText(url, init) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: {
      setCookie: response.headers.get("set-cookie"),
      wwwAuthenticate: response.headers.get("www-authenticate")
    }
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers
    }
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return {
    status: response.status,
    body,
    headers: {
      setCookie: response.headers.get("set-cookie"),
      wwwAuthenticate: response.headers.get("www-authenticate")
    }
  };
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

function hashAdminPassword(password, salt) {
  const digest = pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return ["pbkdf2-sha256", "120000", salt.toString("base64url"), digest.toString("base64url")].join("$");
}

function cookiePair(setCookie) {
  if (setCookie === null || setCookie === undefined) return undefined;
  return setCookie.split(";", 1)[0];
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
      const { port } = address;
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
