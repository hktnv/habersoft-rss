# Admin Operations Dashboard

Status: `SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET`.

MS-025A adds the first authenticated read-only admin operations slice after the MS-024F operator-reported status/auth shell acceptance. It is a local repository package with synthetic acceptance coverage. MS-025A-R2 records later operator-reported production acceptance for the read-only operations summary dashboard.

MS-025B adds the next authenticated read-only Operations Drilldown slice locally. It is `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`: drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence, and No production deployment was performed by Codex for MS-025B-R1.

MS-026A adds the first bounded admin action: `POST /admin-api/operations/feed-recheck-requests`. It is `MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`: local implementation and release-candidate validation only, with operator deploy/retest required. No production deployment was performed by Codex for MS-026A.

MS-026B records the operator-reported MS-026A production route smoke without claiming feed recheck effect acceptance. The route/proxy/auth/HTML-fallback checks are deployed by operator report, but production had no feeds and no eligible actionRef. The effect classification is `NO_ELIGIBLE_FEED_RECHECK_TARGET`, with pending state `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` / `PENDING_NO_ELIGIBLE_TARGET`.

MS-026C adds one-command operator automation and the redacted browser evidence bridge. MS-026C-R1 records `SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET` from operator-reported production retest evidence: `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and critical risk `none`. The feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`; Feed recheck effect acceptance remains future work requiring a real eligible production feed. No production feed was created, seeded, or faked. No fake actionRef was generated. There was no production contact by Codex. The local guard is `npm run verify:operator-automation-acceptance`.

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
POST /admin-api/operations/feed-recheck-requests
```

The read clients use `credentials: "same-origin"`, `cache: "no-store"`, `redirect: "manual"`, and `Accept: application/json`. The feed recheck action client also sends JSON only, `X-Admin-CSRF`, and `X-Admin-Idempotency-Key`. They use no Authorization bearer header, no Tenant bearer token, no Agent key, no custom credential header, and no browser credential persistence. They must not use localStorage, sessionStorage, IndexedDB, cookieStore, or document.cookie.

The overview and drilldown each perform one load after the protected shell is authenticated and then only manual refreshes. They do not poll, persist history, render raw upstream errors, or display raw response bodies. The feed recheck action requires explicit confirmation and does not auto-repeat.

## Runtime Proxy Contract

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is reused as the server-only backend origin for the admin-api route. A third upstream variable is not introduced.

The generated Nginx route:

- allows only `GET /admin-api/operations/summary`;
- allows only `GET /admin-api/operations/drilldown`;
- allows only `POST /admin-api/operations/feed-recheck-requests`;
- rejects non-GET with safe `405`;
- rejects unknown `/admin-api/**` with safe `404`;
- strips query strings with `set $args ""`;
- does not forward request bodies on read routes and caps the action body at 2k;
- forwards only minimum session context: `Host`, `Accept: application/json`, and `Cookie`;
- forwards only `Cookie`, `Content-Type: application/json`, `X-Admin-CSRF`, and `X-Admin-Idempotency-Key` on the action route;
- does not forward Authorization, Proxy-Authorization, Tenant bearer, Agent key, or credential-like custom headers;
- hides upstream `Set-Cookie`, `WWW-Authenticate`, and `Access-Control-*` response headers;
- maps upstream `401/403` to safe unauthenticated JSON;
- maps upstream `500/502/504` to safe unavailable JSON;
- keeps `/healthz`, static assets, and the auth/status exact routes available when admin-api upstream configuration is absent or invalid.

The active generated config path is `/tmp/nginx/conf.d/default.conf`, and `nginx -T` should show that file. `/etc/nginx/conf.d/default.conf` may be stock and should not be used as the authority for this image. The template now includes the admin-api marker before the SPA fallback, plus JSON catch routes for both `/admin-api` and `/admin-api/*`. The entrypoint refuses to start if the generated config contains unresolved `__ADMIN_UI_*__` markers or lacks `location = /admin-api/operations/summary`, `location = /admin-api/operations/drilldown`, or `location = /admin-api/operations/feed-recheck-requests`.

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

Drilldown safe field decision:

- `displayId` values are short opaque hashes, not raw database IDs or check IDs.
- `sourceHost` is only a public hostname. Raw feed URL paths, raw feed URL queries, userinfo, localhost, private IPs, and internal hostnames are redacted to `null`.
- Rows are capped at `maxRows=20`.
- The UI renders only safe text fields escaped by React and never uses `dangerouslySetInnerHTML`.

The drilldown must not expose raw feed URL paths or queries, entry content, entry URLs, raw logs, raw request/response bodies, private hostnames, tenant identifiers, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, stack traces, or write controls.

## Feed Recheck Action

MS-026A adds a bounded feed recheck action for eligible drilldown feed rows:

```text
POST /admin-api/operations/feed-recheck-requests
```

Action contract:

- visible only for rows whose backend metadata has `canRequestRecheck: true`;
- requires explicit confirmation before the POST;
- sends only an opaque `actionRef`, safe `reason: "operator_request"`,
  `X-Admin-CSRF`, and `X-Admin-Idempotency-Key`;
- stores CSRF, idempotency keys, action refs, and responses only in memory;
- handles accepted, already-pending, rate-limited, unavailable,
  unauthenticated, forbidden, timeout, and invalid response states;
- requests the existing due-feed path with no synchronous external feed fetch;
- uses a 300 second cooldown and idempotency dedupe;
- returns safe fields only: status, requestId, displayId, sourceHost, queued,
  cooldownSeconds, message, and generatedAt.

The action must not expose raw feed URL paths or queries, internal database IDs,
entry content, raw logs, raw upstream bodies, stack traces, cookies, session
secrets, CSRF tokens, idempotency keys, Agent key values, Tenant bearer tokens,
or arbitrary admin write controls.

## Feed Onboarding Action

MS-027A adds authenticated admin feed onboarding:

```text
POST /admin-api/operations/feed-onboarding-requests
```

Action contract:

- requires an authenticated admin session and explicit UI confirmation;
- accepts only JSON with a public HTTPS feed URL and optional safe label;
- rejects query strings, non-JSON bodies, credentials/userinfo, fragments,
  localhost/private/internal-style targets, and unsafe labels;
- sends `X-Admin-CSRF` and `X-Admin-Idempotency-Key`;
- stores raw input, CSRF, idempotency keys, and response state only in memory;
- uses a reserved admin onboarding relation so the target can become eligible
  for Operations Drilldown without exposing tenant credentials;
- performs no synchronous external feed fetch;
- returns only status, requestRef, `displayId`, public `sourceHost`, state,
  eligibility, safe message, safe next steps, and generatedAt.

The action must not expose raw feed URL paths or queries in response or
evidence. It must not expose internal database IDs, entry content, raw logs,
raw upstream bodies, stack traces, cookies, session secrets, CSRF tokens,
idempotency keys, Agent key values, Tenant bearer tokens, or arbitrary admin
write controls.

Browser evidence includes `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`,
`feed_onboarding_available`, `feed_onboarding_status`, `no_eligible_target`,
and `critical_risk`. Operator automation classifies the route smoke as
`FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED` when unauthenticated POST returns JSON
`401` and GET returns JSON `405`.

## Local Acceptance

MS-025A local acceptance uses synthetic credentials and local Docker/full-stack infrastructure only:

```bash
npm run test:admin-operations-proxy
npm run test:admin-api-proxy-template
npm run verify:admin-operations-dashboard
npm run verify:admin-operations-drilldown
npm run verify:admin-feed-recheck-action
npm run verify:admin-feed-onboarding
npm run test:fullstack
npm run test:production-mode-rc
```

The harnesses prove disabled auth returns no metrics, unauthenticated sessions return no metrics, valid synthetic login unlocks the route, the frontend proxy strips unsafe headers, the operations UI renders aggregate fields, logout blocks the route again, and browser assets do not contain upstream origins or credential material.

`npm run test:admin-api-proxy-template` specifically proves the generated effective config contains `location = /admin-api/operations/summary`, `location = /admin-api/operations/drilldown`, `location = /admin-api/operations/feed-recheck-requests`, and `location = /admin-api/operations/feed-onboarding-requests`, contains JSON rejection routes for `/admin-api` and `/admin-api/*`, contains no unresolved template markers, orders all admin-api routes before `location /`, and returns JSON for unauthenticated, authenticated, wrong-method, unknown-path, no-auth-upstream, and unreachable-upstream cases. No tested `/admin-api/*` path may return `text/html` or the SPA root element.

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

For MS-025B operator deploy/retest, also check unauthenticated `/admin-api/operations/drilldown` returns bounded JSON `401`, authenticated Operations Drilldown displays JSON data, and logout returns the UI to locked state. `auth-smoke:redacted` without credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an observation/sanity state, not a blocker by itself. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence.

For MS-026A operator deploy/retest, pull main, rebuild/update backend and frontend images as required by current runbooks, recreate backend API/worker if runtime changed, run `npm run ops:compose:recreate`, verify health/status/auth, login in browser, request one safe feed recheck from Operations Drilldown, verify safe JSON/UI states for accepted, already-pending, and rate-limited outcomes, then logout to locked state. Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets.

For MS-027A operator deploy/retest, also verify the running generated Nginx config contains summary, drilldown, feed-recheck, and feed-onboarding routes before the SPA fallback. The operator can use the authenticated Feed Onboarding panel to onboard a real target only through the UI with explicit confirmation. Evidence must report only safe status classes such as `FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED` and `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`; do not paste raw feed URLs, credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies, raw logs, or secrets.

MS-026B operator automation replaces the manual micro-step list with redacted, composable commands:

```bash
npm run ops:production:retest:redacted
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com
npm run verify:operator-automation
```

Backend API/worker recreate guidance is dry-run by default through `npm run ops:production:recreate:api-worker -- --dry-run`; an operator-owned mutation requires `npm run ops:production:recreate:api-worker -- --apply`. Frontend recreate is also dry-run by default and requires `npm run ops:compose:recreate -- --apply` before it mutates production. Authenticated smoke credentials are environment variables only. Feed recheck action smoke is never automatic; it requires `--attempt-feed-recheck` and a real eligible actionRef. If no actionRef exists, report only `NO_ELIGIBLE_FEED_RECHECK_TARGET`.

Risk-based guardrails:

- CRITICAL: always fail closed for secret/credential/session/cookie/CSRF/token exposure, browser persistence APIs, unsafe auth boundary changes, write/action routes missing auth/CSRF/idempotency, admin API HTML fallback, production mutation by Codex, real secret reads, and unsafe production upstream anti-patterns.
- HIGH: block production apply but allow local dry-run diagnostics for missing required env/image files, invalid upstreams, unresolved template markers, and missing action-route proxy generation.
- MEDIUM: warn or degrade for optional/defaulted env, absent credentials for auth smoke, no eligible feed target, missing local Docker in non-critical checks, and host Node/npm warnings when Docker Node 24 validation passes.
- LOW: treat npm update notices, CRLF checkout warnings, and Prisma update notices as informational.

MS-024F status/auth shell acceptance remains operator-reported. MS-025A-R2 records the read-only operations summary dashboard production acceptance by operator report. Durable operator-state receipt outside Git records the R2 closeout; temporary workplace paths are not durable operator artifacts.

MS-026C-R1 durable operator-state receipt outside Git records the automation closeout under `operator-state/admin-ui-production-activation/ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json`; temporary workplace paths are not durable operator artifacts.

## MS-026C Operator Automation and Evidence Bridge

MS-026C lands `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED` for automation and evidence flow only. The one-command operator entry is `npm run ops:production:retest`; use `--dry-run` for planning, `--retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>` for non-mutating route proof and acceptance, and `--apply` only when the operator intends backend/frontend recreate.

Credential-free authenticated checks produce `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`. The authenticated Operations Drilldown UI includes **Copy redacted evidence**; the operator can verify that JSON with `npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>` or locally validate the contract with `npm run verify:browser-evidence`.

Accepted redacted browser classes are `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and future `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`. The evidence schema rejects cookies, session IDs, CSRF tokens, idempotency keys, raw `actionRef`, raw feed URLs, private hostnames, browser storage values, local filesystem paths, raw bodies, raw logs, stack traces, secrets, Agent keys, Tenant bearer/JWT values, and unknown fields.

Feed recheck effect remains `NO_ELIGIBLE_FEED_RECHECK_TARGET` and `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` until a real eligible feed appears through normal production operation. The future closure flow is: operator logs in, opens Operations Drilldown, identifies an eligible row without exposing raw actionRef, triggers one bounded recheck with explicit confirmation, verifies accepted/already-pending UI classification, exports redacted browser evidence, runs the verifier, and reports only the classification plus durable receipt path/hash.

MS-027A status is `SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`. Codex did not perform production contact. No production feed was created, seeded, or faked. Operator deploy/retest required remains.
