# Admin Operations Summary API

Status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

MS-025A adds the backend route for the first authenticated read-only admin operations dashboard slice. It is protected by the existing admin-auth session and is locally validated with synthetic credentials. MS-025A-R2 records later operator-reported production acceptance for this read-only route through the admin UI and proxy.

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

## MS-025A-R2 Operator-Reported Production Acceptance

Bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

Source type: `operator_reported`.

Operator-reported evidence:

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

`AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker. Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load. `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails. Future regression tests may still use credentialed smoke, but credentials must be environment variables only and must not be logged.

Codex did not independently perform a credentialed production login, did not mutate production, did not read real credentials, and did not accept write/business features. Write/business features remain separate bounded milestones.

## Regression Runbook

For future regression checks, use durable production repository paths:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Apply backend deployment or recreate steps under the backend guide if the API image/runtime changed.

cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then use `npm run auth-smoke:redacted`, browser login/logout sanity, and `/admin-api/operations/summary` unauthenticated and authenticated checks as practical regression checks. Report only redacted status classes and aggregate route status. Do not paste real credentials, cookies, session IDs, password hashes, session secrets, Redis keys, raw logs, raw response bodies, or production secret values into Git, docs, chat, or receipts. Durable operator-state receipt outside Git records the closeout; temporary workplace paths are not durable operator artifacts.
