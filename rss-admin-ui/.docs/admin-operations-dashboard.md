# Admin Operations Dashboard

Status: `MS-025B_AUTHENTICATED_READ_ONLY_OPERATIONS_DRILLDOWN_READY_NOT_DEPLOYED`.

MS-025A adds the first authenticated read-only admin operations slice after the MS-024F operator-reported status/auth shell acceptance. It is a local repository package with synthetic acceptance coverage. MS-025A-R2 records later operator-reported production acceptance for the read-only operations summary dashboard.

MS-025B adds the next authenticated read-only Operations Drilldown slice locally. It is `MS-025B_AUTHENTICATED_READ_ONLY_OPERATIONS_DRILLDOWN_READY_NOT_DEPLOYED`: new drilldown production acceptance is pending operator deploy/retest, and No production deployment was performed by Codex for MS-025B.

MS-025A-R1 remediates the operator-reported follow-up where production sign-in and `/admin-auth/session` worked, but `/admin-api/operations/summary` returned HTTP 200 `text/html` with the SPA fallback. The reported container showed generated auth/status routes in `/tmp/nginx/conf.d/default.conf`, but no `/admin-api` route because the running frontend image's active template lacked the admin-api insertion marker. Codex did not contact production to re-check that R1 evidence; the remediation is repository-local and synthetic.

## MS-025A-R2 Operator-Reported Production Acceptance

Bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

Source type: `operator_reported`.

Operator-reported evidence intake:

- `GET /healthz -> 200 OK`;
- `GET /status-api/health/live -> JSON 200`;
- `GET /status-api/health/ready -> JSON 200`;
- unauthenticated `GET /admin-api/operations/summary -> JSON 401`;
- unknown `GET /admin-api/foo -> JSON 404`;
- after browser sign-in, the Operations Overview screen displayed successfully;
- after browser sign-in, JSON aggregate summary data loaded successfully;
- `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`;
- logout returned the UI to locked / unauthenticated state.

Meaning:

- read-only operations dashboard production acceptance is closed;
- admin-api production proxy/template remediation is accepted;
- status dashboard production scope remains accepted;
- authenticated admin shell production scope remains accepted;
- No current MS-025A/R1 operator retest residual remains.

Auth-smoke classification:

- `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker;
- Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load;
- `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails;
- future regression tests may still use credentialed smoke, but credentials must be environment variables only and must not be logged.

Claim boundary:

- Codex did not independently perform a credentialed production login;
- No production deployment was performed by Codex;
- no production mutation, real secret access, registry publication, Git tag, GitHub Release, or PR is claimed;
- future business/admin write features are not accepted;
- write/business features remain separate bounded milestones.

## Browser Contract

The browser route is exact and same-origin:

```text
GET /admin-api/operations/summary
GET /admin-api/operations/drilldown
```

The clients use `credentials: "same-origin"`, `cache: "no-store"`, `redirect: "manual"`, and `Accept: application/json`. They use no Authorization bearer header, no Tenant bearer token, no Agent key, no custom credential header, and no browser credential persistence. They must not use localStorage, sessionStorage, IndexedDB, cookieStore, or document.cookie.

The overview and drilldown each perform one load after the protected shell is authenticated and then only manual refreshes. They do not poll, persist history, call write methods, render raw upstream errors, or display raw response bodies.

## Runtime Proxy Contract

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is reused as the server-only backend origin for the admin-api route. A third upstream variable is not introduced.

The generated Nginx route:

- allows only `GET /admin-api/operations/summary`;
- allows only `GET /admin-api/operations/drilldown`;
- rejects non-GET with safe `405`;
- rejects unknown `/admin-api/**` with safe `404`;
- strips query strings with `set $args ""`;
- does not forward request bodies;
- forwards only minimum session context: `Host`, `Accept: application/json`, and `Cookie`;
- does not forward Authorization, Proxy-Authorization, Tenant bearer, Agent key, or credential-like custom headers;
- hides upstream `Set-Cookie`, `WWW-Authenticate`, and `Access-Control-*` response headers;
- maps upstream `401/403` to safe unauthenticated JSON;
- maps upstream `500/502/504` to safe unavailable JSON;
- keeps `/healthz`, static assets, and the auth/status exact routes available when admin-api upstream configuration is absent or invalid.

The active generated config path is `/tmp/nginx/conf.d/default.conf`, and `nginx -T` should show that file. `/etc/nginx/conf.d/default.conf` may be stock and should not be used as the authority for this image. The template now includes the admin-api marker before the SPA fallback, plus JSON catch routes for both `/admin-api` and `/admin-api/*`. The entrypoint refuses to start if the generated config contains unresolved `__ADMIN_UI_*__` markers or lacks `location = /admin-api/operations/summary` or `location = /admin-api/operations/drilldown`.

If `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent, the route returns `501 not_configured` without operations metrics. If the origin is malformed, public-edge, container-loopback, or unreachable, the route fails closed with bounded unavailable JSON and no upstream hostname or raw diagnostic body.

## Session Cookie Path

MS-025A changes the admin session cookie path from the historical `/admin-auth` scope to `/` so one opaque HttpOnly cookie authenticates both `/admin-auth/*` and `/admin-api/*`.

Required cookie behavior:

- login sets the session cookie with `Path=/`, `HttpOnly`, `SameSite=Lax`, and production `Secure`;
- login also clears the historical `Path=/admin-auth` cookie;
- logout clears both `Path=/` and `Path=/admin-auth`;
- JavaScript never reads, writes, stores, or derives credentials from the cookie.

## Summary Shape

The backend response is aggregate-only:

```json
{
  "status": "ok",
  "generatedAt": "<ISO-8601>",
  "window": {
    "recentHours": 24
  },
  "dependencies": {
    "postgres": "up|down|unknown",
    "redis": "up|down|unknown",
    "tenantAuth": "up|down|unknown"
  },
  "feeds": {
    "total": "<number|null>",
    "active": "<number|null>",
    "disabled": "<number|null>",
    "dueNow": "<number|null>"
  },
  "entries": {
    "total": "<number|null>",
    "createdLast24h": "<number|null>"
  },
  "ingestion": {
    "checksLast24h": "<number|null>",
    "successLast24h": "<number|null>",
    "failedLast24h": "<number|null>",
    "latestCheckAt": "<ISO-8601|null>"
  },
  "notes": [
    {
      "code": "<safe_machine_code>",
      "message": "<safe_operator_message>"
    }
  ]
}
```

Unavailable metrics are `null` plus a safe note such as `operations_metrics_unavailable`. The first aggregate note is `summary_is_aggregate_only`.

The route must not expose tenant identifiers, feed URLs, feed content, entry content, raw logs, raw request/response bodies, upstream origins, private hostnames, cookies, password hashes, session secrets, database URLs, Redis URLs, Agent keys, Tenant tokens, JWT claims, or stack traces.

## Drilldown Shape

The MS-025B backend response is bounded:

```json
{
  "status": "ok|partial|unavailable",
  "generatedAt": "<ISO-8601>",
  "window": {
    "recentHours": 24,
    "maxRows": 20
  },
  "feeds": {
    "status": "ok|partial|unavailable",
    "total": "<number|null>",
    "active": "<number|null>",
    "due": "<number|null>",
    "withRecentSuccess": "<number|null>",
    "withRecentFailure": "<number|null>",
    "rows": [
      {
        "displayId": "feed_<opaque-hash>",
        "displayName": "<safe title|null>",
        "sourceHost": "<public hostname|null>",
        "health": "healthy|degraded|unknown",
        "lastCheckedAt": "<ISO-8601|null>",
        "lastResult": "success|failure|unknown",
        "recentEntryCount": "<number|null>",
        "notes": ["<safe string>"]
      }
    ]
  },
  "ingestion": {
    "status": "ok|partial|unavailable",
    "recentEntryCount": "<number|null>",
    "recentBatchCount": "<number|null>",
    "latestEntryAt": "<ISO-8601|null>",
    "rows": [
      {
        "displayId": "check_<opaque-hash>",
        "feedDisplayId": "feed_<opaque-hash>|null",
        "receivedAt": "<ISO-8601|null>",
        "entryCount": "<number|null>",
        "status": "accepted|skipped|unknown",
        "notes": ["<safe string>"]
      }
    ]
  },
  "notes": ["<safe string>"],
  "capabilities": {
    "feedRows": true,
    "ingestionRows": true,
    "reason": "<safe string|null>"
  }
}
```

Drilldown safe field decision:

- `displayId` values are short opaque hashes, not raw database IDs or check IDs.
- `sourceHost` is only a public hostname. Raw feed URL paths, raw feed URL queries, userinfo, localhost, private IPs, and internal hostnames are redacted to `null`.
- Rows are capped at `maxRows=20`.
- The UI renders only safe text fields escaped by React and never uses `dangerouslySetInnerHTML`.

The drilldown must not expose raw feed URL paths or queries, entry content, entry URLs, raw logs, raw request/response bodies, private hostnames, tenant identifiers, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, stack traces, or write controls.

## Local Acceptance

MS-025A local acceptance uses synthetic credentials and local Docker/full-stack infrastructure only:

```bash
npm run test:admin-operations-proxy
npm run test:admin-api-proxy-template
npm run verify:admin-operations-dashboard
npm run verify:admin-operations-drilldown
npm run test:fullstack
npm run test:production-mode-rc
```

The harnesses prove disabled auth returns no metrics, unauthenticated sessions return no metrics, valid synthetic login unlocks the route, the frontend proxy strips unsafe headers, the operations UI renders aggregate fields, logout blocks the route again, and browser assets do not contain upstream origins or credential material.

`npm run test:admin-api-proxy-template` specifically proves the generated effective config contains `location = /admin-api/operations/summary` and `location = /admin-api/operations/drilldown`, contains JSON rejection routes for `/admin-api` and `/admin-api/*`, contains no unresolved template markers, orders all admin-api routes before `location /`, and returns JSON for unauthenticated, authenticated, wrong-method, unknown-path, no-auth-upstream, and unreachable-upstream cases. No tested `/admin-api/*` path may return `text/html` or the SPA root element.

## Regression Runbook After R2

No current MS-025A/R1 operator retest residual remains. Future regression checks may still use durable repository paths only:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Apply backend deployment or recreate steps under the backend guide if the API image/runtime changed.

cd /opt/habersoft-rss/rss-admin-ui
# Rebuild/update the configured frontend image if nginx.conf or docker-entrypoint.sh changed.
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then verify the running frontend container's effective config includes `/admin-api/operations/summary` and `/admin-api/operations/drilldown` before UI retest:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F "/admin-api/operations/summary" && grep -F "/admin-api/operations/drilldown" /tmp/nginx/conf.d/default.conf && ! grep -F "__ADMIN_UI_" /tmp/nginx/conf.d/default.conf'
```

Then use `npm run auth-smoke:redacted`, browser login/logout sanity, and `/admin-api/operations/summary` unauthenticated and authenticated checks as practical regression checks. Unauthenticated `/admin-api/operations/summary` should return bounded JSON `401` or the documented unauthenticated JSON class, not HTML. `/admin-api/*` must remain JSON fail-closed before the SPA fallback, and unknown `/admin-api/*` must not fall back to `index.html`. Report only redacted status classes and aggregate route status. Do not paste real admin credentials, cookies, session IDs, password hashes, session secrets, Redis keys, raw logs, raw response bodies, or production secret values into Git, docs, chat, or receipts.

For MS-025B operator deploy/retest, also check unauthenticated `/admin-api/operations/drilldown` returns bounded JSON `401`, authenticated Operations Drilldown displays JSON data, and logout returns the UI to locked state. `auth-smoke:redacted` without credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an observation/sanity state, not a blocker by itself. New drilldown production acceptance is pending operator deploy/retest.

MS-024F status/auth shell acceptance remains operator-reported. MS-025A-R2 records the read-only operations summary dashboard production acceptance by operator report. Durable operator-state receipt outside Git records the R2 closeout; temporary workplace paths are not durable operator artifacts.
