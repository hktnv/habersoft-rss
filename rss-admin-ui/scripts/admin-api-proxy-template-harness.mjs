import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultImage = "rss-admin-ui:ms026c-local";
const image = process.env.RSS_ADMIN_UI_ADMIN_API_TEMPLATE_IMAGE ?? process.env.RSS_ADMIN_UI_TEST_IMAGE ?? defaultImage;
const skipBuild = process.env.RSS_ADMIN_UI_ADMIN_API_TEMPLATE_SKIP_BUILD === "true";
const suffix = randomUUID().slice(0, 8);
const network = `rss-admin-ui-ms026c-admin-api-${suffix}`;
const sentinelName = `rss-admin-ui-ms026c-sentinel-${suffix}`;
const frontendName = `rss-admin-ui-ms026c-runtime-${suffix}`;
const staticFrontendName = `rss-admin-ui-ms026c-static-${suffix}`;
const unreachableFrontendName = `rss-admin-ui-ms026c-unreachable-${suffix}`;

try {
  if (!skipBuild || image === defaultImage) {
    docker(["build", "-t", image, "."], { timeoutMs: 600000 });
  } else {
    assert(docker(["image", "inspect", image], { allowFailure: true }).status === 0, `Docker image is not available: ${image}`);
  }

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

  startFrontend(frontendName, "frontend", "http://sentinel:3100");
  await waitForFrontend("frontend");
  docker(["exec", frontendName, "nginx", "-t"]);

  const generatedConfig = docker(["exec", frontendName, "cat", "/tmp/nginx/conf.d/default.conf"]).stdout;
  const nginxDumpResult = docker(["exec", frontendName, "nginx", "-T"]);
  const nginxDump = `${nginxDumpResult.stdout}\n${nginxDumpResult.stderr}`;
  assertGeneratedConfig(generatedConfig, nginxDump);

  const results = runFrontendRequests("frontend");
  assert(results.healthz.status === 200 && results.healthz.body.trim() === "ok", "frontend /healthz failed");
  assert(results.index.status === 200 && results.index.body.includes('<div id="root"></div>'), "static SPA route failed");
  assert(results.env.status === 200 && !results.env.body.includes("sentinel:3100"), "env-config.js leaked upstream or failed");
  assert(results.statusLive.status === 200 && results.statusLive.json?.status === "live", "status live route regressed");
  assert(results.statusReady.status === 200 && results.statusReady.json?.status === "ready", "status ready route regressed");
  assert(results.session.status === 200 && results.session.json?.reason === "unauthenticated", "admin-auth session route regressed");
  assert(results.login.status === 200 && /Path=\//iu.test(results.login.headers.setCookie ?? ""), "admin-auth login route regressed");
  assert(results.logout.status === 200 && /Max-Age=0/iu.test(results.logout.headers.setCookie ?? ""), "admin-auth logout route regressed");

  assertAdminApiJson(results.unauthenticatedSummary, 401, "unauthenticated admin-api summary");
  assert(results.unauthenticatedSummary.json?.authenticated === false, "unauthenticated admin-api summary body mismatch");
  assertAdminApiJson(results.authenticatedSummary, 200, "authenticated admin-api summary");
  assert(results.authenticatedSummary.json?.status === "ok", "authenticated admin-api summary body mismatch");
  assert(results.authenticatedSummary.headers.setCookie === null, "admin-api summary relayed upstream Set-Cookie");
  assertAdminApiJson(results.authenticatedSummaryQuery, 200, "admin-api summary query");
  assertAdminApiJson(results.unauthenticatedDrilldown, 401, "unauthenticated admin-api drilldown");
  assert(results.unauthenticatedDrilldown.json?.authenticated === false, "unauthenticated admin-api drilldown body mismatch");
  assertAdminApiJson(results.authenticatedDrilldown, 200, "authenticated admin-api drilldown");
  assert(results.authenticatedDrilldown.json?.status === "ok", "authenticated admin-api drilldown body mismatch");
  assert(results.authenticatedDrilldown.headers.setCookie === null, "admin-api drilldown relayed upstream Set-Cookie");
  assertAdminApiJson(results.authenticatedDrilldownQuery, 200, "admin-api drilldown query");
  assertAdminApiJson(results.unauthenticatedFeedRecheck, 401, "unauthenticated admin-api feed recheck");
  assert(results.unauthenticatedFeedRecheck.json?.authenticated === false, "unauthenticated feed recheck body mismatch");
  assertAdminApiJson(results.missingCsrfFeedRecheck, 403, "missing CSRF admin-api feed recheck");
  assert(results.missingCsrfFeedRecheck.json?.reason === "csrf_failed", "missing CSRF feed recheck body mismatch");
  assertAdminApiJson(results.authenticatedFeedRecheck, 202, "authenticated admin-api feed recheck");
  assert(results.authenticatedFeedRecheck.json?.status === "accepted", "authenticated feed recheck body mismatch");
  assert(results.authenticatedFeedRecheck.headers.setCookie === null, "admin-api feed recheck relayed upstream Set-Cookie");
  assertAdminApiJson(results.authenticatedFeedRecheckQuery, 202, "admin-api feed recheck query stripping");
  assertAdminApiJson(results.unknownAdminApiExact, 404, "exact unknown /admin-api");
  assertAdminApiJson(results.unknownAdminApiPrefix, 404, "unknown /admin-api path");
  assertAdminApiJson(results.postAdminSummary, 405, "POST admin-api summary");
  assertAdminApiJson(results.postAdminDrilldown, 405, "POST admin-api drilldown");
  assertAdminApiJson(results.getAdminFeedRecheck, 405, "GET admin-api feed recheck");

  const adminRecords = adminApiRecords();
  assert(adminRecords.length === 10, `expected 10 upstream admin-api records, received ${adminRecords.length}`);
  for (const record of adminRecords) {
    const isReadRoute = record.path === "/admin-api/operations/summary" || record.path === "/admin-api/operations/drilldown";
    const isActionRoute = record.path === "/admin-api/operations/feed-recheck-requests";
    assert(isReadRoute || isActionRoute, "admin-api upstream path mismatch");
    assert(record.method === (isActionRoute ? "POST" : "GET"), "admin-api upstream method mismatch");
    assert(record.search === "", "admin-api query string reached upstream");
    assert(record.bodyPresent === isActionRoute, "admin-api request body forwarding mismatch");
    assert(record.sensitiveHeaders.authorization === false, "authorization header reached admin-api upstream");
    assert(record.sensitiveHeaders.proxyAuthorization === false, "proxy authorization header reached admin-api upstream");
    assert(record.sensitiveHeaders.agentKey === false, "agent key header reached admin-api upstream");
    assert(record.customCredentialLikeHeader === false, "credential-like custom header reached admin-api upstream");
    if (isReadRoute) {
      assert(record.adminActionHeaders.csrf === false, "read admin-api route forwarded CSRF header");
      assert(record.adminActionHeaders.idempotency === false, "read admin-api route forwarded idempotency header");
    }
  }
  const actionRecords = adminRecords.filter((record) => record.path === "/admin-api/operations/feed-recheck-requests");
  assert(
    actionRecords.some((record) => record.sensitiveHeaders.cookie && record.adminActionHeaders.csrf && record.adminActionHeaders.idempotency),
    "authenticated feed recheck did not forward CSRF and idempotency headers"
  );
  assert(
    actionRecords.some((record) => record.sensitiveHeaders.cookie && !record.adminActionHeaders.csrf && record.adminActionHeaders.idempotency),
    "missing-CSRF feed recheck negative path was not exercised"
  );
  assert(adminRecords.some((record) => record.sensitiveHeaders.cookie === false), "unauthenticated admin-api request should not invent a cookie");
  assert(adminRecords.some((record) => record.sensitiveHeaders.cookie === true), "authenticated admin-api request did not forward session cookie");

  startFrontend(staticFrontendName, "frontend-static", "");
  await waitForFrontend("frontend-static");
  const staticSummary = runSingleRequest("frontend-static", "/admin-api/operations/summary");
  const staticDrilldown = runSingleRequest("frontend-static", "/admin-api/operations/drilldown");
  const staticFeedRecheck = runSingleRequest("frontend-static", "/admin-api/operations/feed-recheck-requests", { method: "POST" });
  assertAdminApiJson(staticSummary, 501, "static no-auth-upstream admin-api summary");
  assertAdminApiJson(staticDrilldown, 501, "static no-auth-upstream admin-api drilldown");
  assertAdminApiJson(staticFeedRecheck, 501, "static no-auth-upstream admin-api feed recheck");

  startFrontend(unreachableFrontendName, "frontend-unreachable", "http://missing-admin-api-r1:3100");
  await waitForFrontend("frontend-unreachable");
  const unreachableSummary = runSingleRequest("frontend-unreachable", "/admin-api/operations/summary");
  const unreachableDrilldown = runSingleRequest("frontend-unreachable", "/admin-api/operations/drilldown");
  const unreachableFeedRecheck = runSingleRequest("frontend-unreachable", "/admin-api/operations/feed-recheck-requests", { method: "POST" });
  assertAdminApiJson(unreachableSummary, 502, "unreachable admin-api upstream summary");
  assertAdminApiJson(unreachableDrilldown, 502, "unreachable admin-api upstream drilldown");
  assertAdminApiJson(unreachableFeedRecheck, 502, "unreachable admin-api upstream feed recheck");

  console.log(
    JSON.stringify(
      {
        status: "admin-api-proxy-template-harness-ok",
        image,
        generated_config: "/tmp/nginx/conf.d/default.conf",
        exact_routes: ["/admin-api/operations/summary", "/admin-api/operations/drilldown", "/admin-api/operations/feed-recheck-requests"],
        no_spa_fallback_for_admin_api: true,
        upstream_records: adminRecords.length,
        static_no_auth_status: staticSummary.status,
        static_no_auth_drilldown_status: staticDrilldown.status,
        static_no_auth_feed_recheck_status: staticFeedRecheck.status,
        unreachable_status: unreachableSummary.status,
        unreachable_drilldown_status: unreachableDrilldown.status,
        unreachable_feed_recheck_status: unreachableFeedRecheck.status
      },
      null,
      2
    )
  );
} finally {
  docker(["rm", "-f", frontendName], { allowFailure: true });
  docker(["rm", "-f", staticFrontendName], { allowFailure: true });
  docker(["rm", "-f", unreachableFrontendName], { allowFailure: true });
  docker(["rm", "-f", sentinelName], { allowFailure: true });
  docker(["network", "rm", network], { allowFailure: true });
}

function startFrontend(name, alias, authOrigin) {
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
    "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://sentinel:3100",
    "-e",
    `ADMIN_UI_AUTH_UPSTREAM_ORIGIN=${authOrigin}`,
    "-e",
    "ADMIN_UI_ENVIRONMENT_NAME=admin-api-proxy-template-harness",
    image
  ]);
}

function assertGeneratedConfig(generatedConfig, nginxDump) {
  assert(nginxDump.includes("/tmp/nginx/conf.d/default.conf"), "nginx -T did not include the generated /tmp config");
  for (const text of [generatedConfig, nginxDump]) {
    assert(!/__ADMIN_UI_[A-Z0-9_]+__/u.test(text), "generated Nginx config contains unresolved admin UI markers");
    assert(text.includes("location = /admin-api/operations/summary"), "generated Nginx config lacks exact admin-api summary route");
    assert(text.includes("location = /admin-api/operations/drilldown"), "generated Nginx config lacks exact admin-api drilldown route");
    assert(text.includes("location = /admin-api/operations/feed-recheck-requests"), "generated Nginx config lacks exact admin-api feed recheck route");
    assert(text.includes("proxy_set_header X-Admin-CSRF"), "generated Nginx config lacks admin CSRF forwarding");
    assert(text.includes("proxy_set_header X-Admin-Idempotency-Key"), "generated Nginx config lacks admin idempotency forwarding");
    assert(/location\s*=\s*\/admin-api\s*\{/u.test(text), "generated Nginx config lacks exact /admin-api JSON 404 route");
    assert(/location\s*\^~\s*\/admin-api\/\s*\{/u.test(text), "generated Nginx config lacks /admin-api/ JSON 404 route");
  }

  const summaryIndex = generatedConfig.indexOf("location = /admin-api/operations/summary");
  const drilldownIndex = generatedConfig.indexOf("location = /admin-api/operations/drilldown");
  const feedRecheckIndex = generatedConfig.indexOf("location = /admin-api/operations/feed-recheck-requests");
  const exactFallbackIndex = indexOfRegex(generatedConfig, /location\s*=\s*\/admin-api\s*\{/u);
  const prefixFallbackIndex = indexOfRegex(generatedConfig, /location\s*\^~\s*\/admin-api\/\s*\{/u);
  const spaFallbackIndex = indexOfRegex(generatedConfig, /location\s+\/\s*\{/u);
  assert(
      summaryIndex !== -1 &&
      drilldownIndex !== -1 &&
      feedRecheckIndex !== -1 &&
      exactFallbackIndex !== -1 &&
      prefixFallbackIndex !== -1 &&
      spaFallbackIndex !== -1,
    "route order proof could not locate all routes"
  );
  assert(summaryIndex < spaFallbackIndex, "admin-api summary route appears after SPA fallback");
  assert(drilldownIndex < spaFallbackIndex, "admin-api drilldown route appears after SPA fallback");
  assert(feedRecheckIndex < spaFallbackIndex, "admin-api feed recheck route appears after SPA fallback");
  assert(exactFallbackIndex < spaFallbackIndex, "exact /admin-api fallback appears after SPA fallback");
  assert(prefixFallbackIndex < spaFallbackIndex, "/admin-api/ fallback appears after SPA fallback");
}

function indexOfRegex(value, pattern) {
  return pattern.exec(value)?.index ?? -1;
}

function runFrontendRequests(host) {
  return runJsonInNetwork(`
    const base = "http://${host}:8080";
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
          contentType: response.headers.get("content-type"),
          cacheControl: response.headers.get("cache-control"),
          setCookie: response.headers.get("set-cookie"),
          wwwAuthenticate: response.headers.get("www-authenticate")
        }
      };
    }
    const sensitiveHeaders = {
      authorization: "redacted",
      "proxy-authorization": "redacted",
      "x-agent-key": "redacted",
      "x-custom-credential": "redacted"
    };
    const authedHeaders = {
      ...sensitiveHeaders,
      cookie: "habersoft_admin_session=valid"
    };
    const results = {
      healthz: await request("/healthz"),
      index: await request("/"),
      env: await request("/env-config.js"),
      statusLive: await request("/status-api/health/live"),
      statusReady: await request("/status-api/health/ready"),
      session: await request("/admin-auth/session", { headers: sensitiveHeaders }),
      login: await request("/admin-auth/login", {
        method: "POST",
        headers: { ...sensitiveHeaders, "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "redacted" })
      }),
      logout: await request("/admin-auth/logout", { method: "POST", headers: authedHeaders }),
      unauthenticatedSummary: await request("/admin-api/operations/summary", { headers: sensitiveHeaders }),
      authenticatedSummary: await request("/admin-api/operations/summary", { headers: authedHeaders }),
      authenticatedSummaryQuery: await request("/admin-api/operations/summary?token=example", { headers: authedHeaders }),
      unauthenticatedDrilldown: await request("/admin-api/operations/drilldown", { headers: sensitiveHeaders }),
      authenticatedDrilldown: await request("/admin-api/operations/drilldown", { headers: authedHeaders }),
      authenticatedDrilldownQuery: await request("/admin-api/operations/drilldown?token=example", { headers: authedHeaders }),
      unauthenticatedFeedRecheck: await request("/admin-api/operations/feed-recheck-requests", {
        method: "POST",
        headers: { ...sensitiveHeaders, "content-type": "application/json" },
        body: JSON.stringify({ actionRef: "feed_recheck_v1." + "A".repeat(64), reason: "operator_request" })
      }),
      missingCsrfFeedRecheck: await request("/admin-api/operations/feed-recheck-requests", {
        method: "POST",
        headers: { ...authedHeaders, "content-type": "application/json", "x-admin-idempotency-key": "idem_1234567890abcdef" },
        body: JSON.stringify({ actionRef: "feed_recheck_v1." + "A".repeat(64), reason: "operator_request" })
      }),
      authenticatedFeedRecheck: await request("/admin-api/operations/feed-recheck-requests", {
        method: "POST",
        headers: {
          ...authedHeaders,
          "content-type": "application/json",
          "x-admin-csrf": "csrf_token_value_at_least_32_characters",
          "x-admin-idempotency-key": "idem_1234567890abcdef"
        },
        body: JSON.stringify({ actionRef: "feed_recheck_v1." + "A".repeat(64), reason: "operator_request" })
      }),
      authenticatedFeedRecheckQuery: await request("/admin-api/operations/feed-recheck-requests?token=example", {
        method: "POST",
        headers: {
          ...authedHeaders,
          "content-type": "application/json",
          "x-admin-csrf": "csrf_token_value_at_least_32_characters",
          "x-admin-idempotency-key": "idem_abcdef1234567890"
        },
        body: JSON.stringify({ actionRef: "feed_recheck_v1." + "A".repeat(64), reason: "operator_request" })
      }),
      unknownAdminApiExact: await request("/admin-api", { headers: authedHeaders }),
      unknownAdminApiPrefix: await request("/admin-api/unknown", { headers: authedHeaders }),
      postAdminSummary: await request("/admin-api/operations/summary", {
        method: "POST",
        headers: authedHeaders,
        body: "mutate=true"
      }),
      postAdminDrilldown: await request("/admin-api/operations/drilldown", {
        method: "POST",
        headers: authedHeaders,
        body: "mutate=true"
      }),
      getAdminFeedRecheck: await request("/admin-api/operations/feed-recheck-requests", {
        headers: authedHeaders
      })
    };
    console.log(JSON.stringify(results));
  `);
}

function runSingleRequest(host, pathname, init = {}) {
  return runJsonInNetwork(`
    const response = await fetch("http://${host}:8080${pathname}", { redirect: "manual", ...${JSON.stringify(init)} });
    const body = await response.text();
    let json = null;
    try { json = JSON.parse(body); } catch {}
    console.log(JSON.stringify({
      status: response.status,
      body,
      json,
      headers: {
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
        setCookie: response.headers.get("set-cookie"),
        wwwAuthenticate: response.headers.get("www-authenticate")
      }
    }));
  `);
}

function assertAdminApiJson(result, status, label) {
  assert(result.status === status, `${label} returned ${result.status}, expected ${status}`);
  assert(/application\/json/iu.test(result.headers.contentType ?? ""), `${label} was not JSON`);
  assert(/no-store/iu.test(result.headers.cacheControl ?? ""), `${label} was cacheable`);
  assert(result.json !== null, `${label} body was not parseable JSON`);
  assert(result.headers.wwwAuthenticate === null, `${label} relayed WWW-Authenticate`);
  assert(!/text\/html/iu.test(result.headers.contentType ?? ""), `${label} returned HTML content type`);
  assert(!/<!doctype html|<html|<div id="root"><\/div>/iu.test(result.body), `${label} fell through to SPA HTML`);
}

function adminApiRecords() {
  const result = docker([
    "exec",
    sentinelName,
    "node",
    "-e",
    "fetch('http://127.0.0.1:3100/__records?surface=admin-api').then(async (r) => { console.log(await r.text()); }).catch(() => process.exit(1));"
  ]);
  return JSON.parse(result.stdout);
}

function runJsonInNetwork(program) {
  const result = docker(["run", "--rm", "--network", network, "node:24-alpine", "node", "-e", program], {
    timeoutMs: 120000
  });
  return JSON.parse(result.stdout);
}

async function waitForFrontend(host) {
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
        `fetch('http://${host}:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));`
      ],
      { allowFailure: true, timeoutMs: 30000 }
    );
    if (result.status === 0) return;
    await sleep(1000);
  }
  throw new Error(`${host} runtime did not become healthy`);
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
        response.end(JSON.stringify(
          surface === "admin-api"
            ? records.filter((record) => record.path.startsWith("/admin-api/"))
            : records
        ));
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
          adminActionHeaders: {
            csrf: request.headers["x-admin-csrf"] !== undefined,
            idempotency: request.headers["x-admin-idempotency-key"] !== undefined
          },
          customCredentialLikeHeader: headerNames.some((name) =>
            /credential|token|key/i.test(name) &&
            name !== "x-admin-idempotency-key" &&
            name !== "x-admin-csrf"
          )
        });

        response.setHeader("Content-Type", "application/json");
        emitCorsHeaders(response);
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
          if (isAuthenticated(request)) {
            response.end(JSON.stringify({
              configured: true,
              authenticated: true,
              principal: { kind: "single_admin", displayName: "Admin" },
              expiresAt: "2026-06-30T10:00:00.000Z",
              csrfToken: "csrf_token_value_at_least_32_characters"
            }));
          } else {
            response.end(JSON.stringify({ configured: true, authenticated: false, reason: "unauthenticated" }));
          }
          return;
        }

        if (parsed.pathname === "/admin-auth/login") {
          response.setHeader("Set-Cookie", [
            "habersoft_admin_session=valid; HttpOnly; Path=/; SameSite=Lax",
            "habersoft_admin_session=; HttpOnly; Path=/admin-auth; SameSite=Lax; Max-Age=0"
          ]);
          response.end(JSON.stringify({
            configured: true,
            authenticated: true,
            principal: { kind: "single_admin", displayName: "Admin" },
            expiresAt: "2026-06-30T10:00:00.000Z",
            csrfToken: "csrf_token_value_at_least_32_characters"
          }));
          return;
        }

        if (parsed.pathname === "/admin-auth/logout") {
          response.setHeader("Set-Cookie", [
            "habersoft_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
            "habersoft_admin_session=; HttpOnly; Path=/admin-auth; SameSite=Lax; Max-Age=0"
          ]);
          response.end(JSON.stringify({ configured: true, authenticated: false, reason: "logged_out" }));
          return;
        }

        if (parsed.pathname === "/admin-api/operations/summary") {
          response.setHeader("Set-Cookie", "should_not_relay=1; HttpOnly; Path=/; SameSite=Lax");
          if (!isAuthenticated(request)) {
            response.statusCode = 401;
            response.end(JSON.stringify({ authenticated: false, reason: "unauthenticated" }));
            return;
          }
          response.end(JSON.stringify({
            status: "ok",
            generatedAt: "2026-06-30T06:00:00.000Z",
            window: { recentHours: 24 },
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" },
            feeds: { total: 1, active: 1, disabled: 0, dueNow: 0 },
            entries: { total: 2, createdLast24h: 1 },
            ingestion: { checksLast24h: 3, successLast24h: 2, failedLast24h: 1, latestCheckAt: "2026-06-30T05:00:00.000Z" },
            notes: [{ code: "summary_is_aggregate_only", message: "Aggregate counts only." }]
          }));
          return;
        }

        if (parsed.pathname === "/admin-api/operations/drilldown") {
          response.setHeader("Set-Cookie", "should_not_relay=1; HttpOnly; Path=/; SameSite=Lax");
          if (!isAuthenticated(request)) {
            response.statusCode = 401;
            response.end(JSON.stringify({ authenticated: false, reason: "unauthenticated" }));
            return;
          }
          response.end(JSON.stringify({
            status: "ok",
            generatedAt: "2026-06-30T06:00:00.000Z",
            window: { recentHours: 24, maxRows: 20 },
            feeds: {
              status: "ok",
              total: 1,
              active: 1,
              due: 0,
              withRecentSuccess: 1,
              withRecentFailure: 0,
              rows: [{
                displayId: "feed_123456abcd",
                displayName: "Example News",
                sourceHost: "news.example.org",
                health: "healthy",
                lastCheckedAt: "2026-06-30T05:00:00.000Z",
                lastResult: "success",
                recentEntryCount: 1,
                notes: [],
                canRequestRecheck: true,
                recheckUnavailableReason: null,
                actionRef: "feed_recheck_v1." + "A".repeat(64)
              }]
            },
            ingestion: {
              status: "ok",
              recentEntryCount: 1,
              recentBatchCount: 1,
              latestEntryAt: "2026-06-30T05:55:00.000Z",
              rows: [{
                displayId: "check_abcdef1234",
                feedDisplayId: "feed_123456abcd",
                receivedAt: "2026-06-30T05:45:00.000Z",
                entryCount: 1,
                status: "accepted",
                notes: []
              }]
            },
            notes: ["Drilldown rows are bounded and safe."],
            capabilities: { feedRows: true, ingestionRows: true, reason: null }
          }));
          return;
        }

        if (parsed.pathname === "/admin-api/operations/feed-recheck-requests") {
          response.setHeader("Set-Cookie", "should_not_relay=1; HttpOnly; Path=/; SameSite=Lax");
          if (!isAuthenticated(request)) {
            response.statusCode = 401;
            response.end(JSON.stringify({ authenticated: false, reason: "unauthenticated" }));
            return;
          }
          if (request.headers["x-admin-csrf"] === undefined) {
            response.statusCode = 403;
            response.end(JSON.stringify({ authenticated: true, reason: "csrf_failed" }));
            return;
          }
          response.statusCode = 202;
          response.end(JSON.stringify({
            status: "accepted",
            requestId: "recheck_abc123def456",
            target: { displayId: "feed_123456abcd", sourceHost: "news.example.org" },
            queued: true,
            cooldownSeconds: 300,
            message: "Feed recheck was requested through the existing due-feed path.",
            generatedAt: "2026-06-30T06:01:00.000Z"
          }));
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ status: "unexpected" }));
      });
    });
    server.listen(3100, "0.0.0.0");

    function isAuthenticated(request) {
      return /(?:^|;\s*)habersoft_admin_session=valid(?:;|$)/u.test(request.headers.cookie ?? "");
    }

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
