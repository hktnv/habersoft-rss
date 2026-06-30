# Admin Operations Dashboard

Status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`.

MS-025A adds the first authenticated read-only admin operations slice after the MS-024F operator-reported status/auth shell acceptance. It is a local repository package with synthetic acceptance coverage. It does not claim live production acceptance for the new operations dashboard; production deployment and retest remain operator-managed.

## Browser Contract

The browser route is exact and same-origin:

```text
GET /admin-api/operations/summary
```

The client uses `credentials: "same-origin"`, `cache: "no-store"`, `redirect: "manual"`, and `Accept: application/json`. It uses no Authorization bearer header, no Tenant token, no Agent key, no custom credential header, and no browser credential persistence. It must not use localStorage, sessionStorage, IndexedDB, cookieStore, or `document.cookie`.

The overview performs one load after the protected shell is authenticated and then only manual refreshes. It does not poll, persist history, call write methods, render raw upstream errors, or display raw response bodies.

## Runtime Proxy Contract

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is reused as the server-only backend origin for the admin-api route. A third upstream variable is not introduced.

The generated Nginx route:

- allows only `GET /admin-api/operations/summary`;
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

## Local Acceptance

MS-025A local acceptance uses synthetic credentials and local Docker/full-stack infrastructure only:

```bash
npm run test:admin-operations-proxy
npm run verify:admin-operations-dashboard
npm run test:fullstack
npm run test:production-mode-rc
```

The harnesses prove disabled auth returns no metrics, unauthenticated sessions return no metrics, valid synthetic login unlocks the route, the frontend proxy strips unsafe headers, the operations UI renders aggregate fields, logout blocks the route again, and browser assets do not contain upstream origins or credential material.

## Operator Retest Boundary

After an operator deploys a SHA containing MS-025A, retest with durable repository paths only:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Apply backend deployment or recreate steps under the backend guide if the API image/runtime changed.

cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then verify login, `GET /admin-auth/session`, `GET /admin-api/operations/summary`, Operations Overview rendering, logout, and locked-after-logout behavior. Report only redacted status classes and aggregate route status. Do not paste real admin credentials, cookies, session IDs, password hashes, session secrets, Redis keys, raw logs, raw response bodies, or production secret values into Git, docs, chat, or receipts.

MS-024F status/auth shell acceptance remains operator-reported. MS-025A production activation remains pending operator deploy/retest until a later evidence intake explicitly records it.
