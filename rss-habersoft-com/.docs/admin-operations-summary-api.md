# Admin Operations Summary API

Status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`.

MS-025A adds the backend route for the first authenticated read-only admin operations dashboard slice. It is protected by the existing admin-auth session and is locally validated with synthetic credentials. It does not claim live production acceptance; operator deployment and retest remain separate.

## Route

```text
GET /admin-api/operations/summary
```

Auth behavior:

- `ADMIN_UI_AUTH_MODE=disabled` returns HTTP `501` with `not_configured` and no operations metrics.
- Missing or invalid admin session returns HTTP `401` with no operations metrics.
- Valid admin session returns HTTP `200` with the aggregate summary.
- `POST`, `PUT`, `PATCH`, and `DELETE` on the summary route return HTTP `405`.
- Unknown `/admin-api/*` routes return HTTP `404`.

The route uses the same opaque Redis-backed admin session as `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`. MS-025A sets the admin session cookie with `Path=/` so the browser sends it to both `/admin-auth/*` and `/admin-api/*`. Login clears the historical `Path=/admin-auth` cookie, and logout clears both paths. The cookie remains `HttpOnly`, `SameSite=Lax`, and `Secure` when configured for production.

## Response Shape

The success response is aggregate-only:

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

Metric sources:

- `feeds.total`, `feeds.active`, `feeds.disabled`, and `feeds.dueNow` come from aggregate `Feed` counts.
- `entries.total` and `entries.createdLast24h` come from aggregate `Entry` counts.
- `ingestion.*` comes from aggregate `AgentFeedCheckEvent` counts over the last 24 hours.
- `dependencies` reuses the existing readiness dependency states.

When aggregate metrics cannot be computed safely, the route returns `null` metrics and a safe `operations_metrics_unavailable` note. When dependency readiness cannot be checked safely, it returns `unknown` dependency states and a safe `dependency_status_unavailable` note.

## Exclusions

The API must not return tenant identifiers, feed URLs, feed content, entry content, raw request/response bodies, raw logs, upstream origins, private hostnames, cookies, password hashes, session secrets, database URLs, Redis URLs, Agent keys, Tenant tokens, JWT claims, stack traces, or per-row data.

The API does not add write behavior, Tenant browser credentials, Agent browser credentials, Prisma schema changes, migrations, CORS broadening, registry publication, Git tags, releases, or production deployment.

## Validation

Focused backend coverage:

```bash
node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/admin-auth/admin-auth.controller.spec.ts test/admin-api/admin-operations-summary.controller.spec.ts
npm run typecheck
npm test
npm run build
```

Frontend/full-stack coverage is owned by `rss-admin-ui`:

```bash
npm run test:admin-operations-proxy
npm run verify:admin-operations-dashboard
npm run test:fullstack
npm run test:production-mode-rc
```

Run the frontend commands from `rss-admin-ui`.

## Operator Retest Boundary

After a SHA containing MS-025A is deployed by an operator, retest with durable production repository paths:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Apply backend deployment or recreate steps under the backend guide if the API image/runtime changed.

cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then verify login, `GET /admin-auth/session`, `GET /admin-api/operations/summary`, the Operations Overview UI, logout, and locked-after-logout behavior. Report only redacted status classes and aggregate route status. Do not paste real credentials, cookies, session IDs, password hashes, session secrets, Redis keys, raw logs, raw response bodies, or production secret values into Git, docs, chat, or receipts.
