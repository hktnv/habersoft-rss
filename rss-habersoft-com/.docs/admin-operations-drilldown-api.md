# Admin Operations Drilldown API

Status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

MS-025B adds the next authenticated read-only admin operations slice after the
operator-reported MS-025A-R2 operations summary acceptance. The new drilldown is
repository-local and locally validated only. New drilldown production acceptance
is pending operator deploy/retest; no production deployment was performed by
Codex for MS-025B.

## Route

```text
GET /admin-api/operations/drilldown
```

Auth behavior:

- `ADMIN_UI_AUTH_MODE=disabled` returns HTTP `501` with `not_configured` and no
  drilldown rows.
- Missing or invalid admin session returns HTTP `401` with no drilldown rows.
- Valid admin session returns HTTP `200` with bounded JSON.
- `POST`, `PUT`, `PATCH`, and `DELETE` return HTTP `405`.
- Unknown `/admin-api/*` routes return HTTP `404`.

The route uses the same opaque admin session as `/admin-auth/session`,
`/admin-auth/login`, `/admin-auth/logout`, and the accepted summary route. It
adds no auth system and no browser Agent key or Tenant bearer credential.

## Response Shape

The success response is bounded:

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

Safe field decision:

- `displayId` values are short opaque hashes, not raw database IDs or check IDs.
- `sourceHost` is only a public hostname derived from a feed URL. Raw feed URL
  paths, query strings, userinfo, localhost, private IPs, and internal hostnames
  are redacted to `null` with a safe note.
- Entry content, entry title, entry URL, raw feed content, raw logs, raw
  request/response bodies, stack traces, Tenant identifiers, Agent keys, Tenant
  bearer tokens, JWT claims, cookies, password hashes, session secrets,
  database URLs, Redis URLs, and private hostnames are excluded.

If a section cannot be read safely, its status becomes `unavailable`, metrics
become `null`, rows become empty, and the top-level status becomes `partial` or
`unavailable`. No raw diagnostics are returned.

## Validation

Focused backend coverage:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin-api/admin-operations-drilldown.controller.spec.ts
npm run typecheck
npm test
npm run build
```

Frontend and proxy coverage is owned by `rss-admin-ui`:

```bash
npm run verify:admin-operations-drilldown
npm run test:admin-api-proxy-template
npm run test:admin-operations-proxy
npm run test:fullstack
npm run test:production-mode-rc
```

The proxy harness proves the generated active Nginx config at
`/tmp/nginx/conf.d/default.conf` and `nginx -T` contain the exact drilldown route
before the SPA fallback. It also proves unauthenticated, unavailable,
wrong-method, unknown-path, no-auth-upstream, and unreachable-upstream cases
return JSON rather than HTML.

## Production Boundary

MS-025A-R2 remains accepted for the existing read-only operations summary
dashboard by operator report. MS-025B-R1 closes the read-only drilldown production acceptance by operator report.

For a later operator-managed retest:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Apply backend deployment or recreate steps under the backend guide if the API
# image/runtime changed.

cd /opt/habersoft-rss/rss-admin-ui
# Rebuild or update the configured frontend image if nginx.conf or
# docker-entrypoint.sh changed.
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then test `/healthz`, `/status-api/health/live`, `/status-api/health/ready`,
unauthenticated `GET /admin-api/operations/drilldown` returning JSON `401`, an
authenticated browser view showing Operations Drilldown with JSON data, and
logout returning the UI to the locked state. `auth-smoke:redacted` without
credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an
observation/sanity state, not a blocker by itself. Do not paste credentials,
cookies, raw response bodies, logs, or secrets into Git, docs, chat, or receipts.
