# Admin Operations Drilldown API

Status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

MS-025B adds the next authenticated read-only admin operations slice after the
operator-reported MS-025A-R2 operations summary acceptance. The new drilldown is
accepted by operator-reported MS-025B-R1 live retest evidence. No production
deployment was performed by Codex for MS-025B-R1.

MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED
extends eligible feed rows with bounded action metadata and adds the separate
bounded feed recheck action route. No production deployment was performed by
Codex for MS-026A; operator deploy/retest required remains for the new action.

## Route

```text
GET /admin-api/operations/drilldown
POST /admin-api/operations/feed-recheck-requests
```

Auth behavior:

- `ADMIN_UI_AUTH_MODE=disabled` returns HTTP `501` with `not_configured` and no
  drilldown rows.
- Missing or invalid admin session returns HTTP `401` with no drilldown rows.
- Valid admin session returns HTTP `200` with bounded JSON.
- `POST`, `PUT`, `PATCH`, and `DELETE` return HTTP `405`.
- Unknown `/admin-api/*` routes return HTTP `404`.
- The feed recheck action route is `POST` only and returns safe JSON for
  malformed body, unauthenticated, CSRF, duplicate, cooldown, not-found, and
  unavailable states.

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
        "notes": ["<safe string>"],
        "canRequestRecheck": "<boolean>",
        "recheckUnavailableReason": "admin_auth_not_configured|inactive_feed|no_subscribers|source_host_redacted|null",
        "actionRef": "feed_recheck_v1.<opaque>|null"
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
- `actionRef` values are encrypted opaque references for the action route, not
  raw database IDs.
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

## Bounded Feed Recheck Action

MS-026A adds:

```text
POST /admin-api/operations/feed-recheck-requests
```

The route accepts only JSON with an opaque `actionRef` and optional safe
`reason: "operator_request"`. It requires the existing admin session,
`X-Admin-CSRF`, and `X-Admin-Idempotency-Key`. The CSRF token is derived from the
server-side admin session and returned only in authenticated same-origin session
responses. The frontend keeps it in memory only.

Idempotency is enforced with Redis using a short TTL. A duplicate idempotency key
for the same action returns `already_pending`; reuse for a different action is
rejected safely. A per-target cooldown of 300 seconds returns `rate_limited`
with safe `cooldownSeconds` information.

Accepted requests use the existing due-feed path by moving one eligible feed's
`nextCheckAt` to the request timestamp. The HTTP route performs no synchronous
external feed fetch, does not enqueue arbitrary jobs, does not mutate entries,
does not edit feed URLs, and does not use Agent keys or Tenant bearer tokens
from the browser.

Safe response fields are limited to `status`, `requestId`, `target.displayId`,
`target.sourceHost`, `queued`, `cooldownSeconds`, `message`, and `generatedAt`.
Raw feed URL paths or queries, internal IDs, entry content, raw logs, stack
traces, cookies, CSRF tokens, idempotency keys, session secrets, Agent key
values, and Tenant bearer tokens are excluded.

## Authenticated Admin Feed Onboarding

MS-027A adds:

```text
POST /admin-api/operations/feed-onboarding-requests
```

The route accepts only JSON with a public HTTPS `feedUrl` and optional safe
label. It requires the existing admin session, `X-Admin-CSRF`, and
`X-Admin-Idempotency-Key`; rejects query strings, unsafe targets, unknown body
keys, credentials/userinfo, fragments, localhost/private/internal-style hosts,
and unsafe labels; and enforces Redis idempotency plus host cooldown.

Accepted requests store a reserved admin onboarding relation and update only
the existing feed/subscription state needed for an eligible target to appear.
The HTTP route performs no synchronous external feed fetch, does not mutate
entries, does not use Agent keys or Tenant bearer tokens from the browser, and
does not require a Prisma migration. Tenant JWT validation rejects the reserved
admin site client ID so tenant callers cannot claim that relation.

Safe response fields are limited to `status`, `requestRef`, `feed.displayId`,
`feed.sourceHost`, `feed.state`, `feed.eligibleForRecheck`, `nextSteps`,
`message`, and `generatedAt`. There is no raw feed URL in response or evidence.

Operator route smoke classifies `FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED`.
Browser evidence includes `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`,
`feed_onboarding_available`, `feed_onboarding_status`, `no_eligible_target`,
and `critical_risk`. Status:
`SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`.
Codex did not perform production contact. No production feed was created,
seeded, or faked. Operator deploy/retest required remains.

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
npm run verify:admin-feed-recheck-action
npm run verify:admin-feed-onboarding
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
authenticated browser view showing Operations Drilldown with JSON data, one
safe feed recheck request from Operations Drilldown, duplicate/cooldown UI
state, and logout returning the UI to the locked state. `auth-smoke:redacted`
without credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an
observation/sanity state, not a blocker by itself. Do not paste credentials,
cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with
sensitive values, raw feed URLs, logs, or secrets into Git, docs, chat, or
receipts.
