# Admin Auth Session Boundary

Status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

Historical foundation status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

MS-022A adds a local/tested same-origin admin auth/session foundation. MS-025A keeps that session model and uses it for the protected read-only admin operations summary route, later accepted by operator-reported MS-025A-R2 production evidence. MS-025B uses the same session model for a protected read-only operations drilldown route. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. MS-026A adds the first bounded feed recheck action and keeps operator deploy/retest required.

## Current Boundary

- Backend admin auth is disabled by default with `ADMIN_UI_AUTH_MODE=disabled`.
- There is no default admin credential. `single_admin` mode requires `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, and `ADMIN_UI_SESSION_SECRET`.
- The browser uses only same-origin `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`.
- The frontend runtime proxies those auth paths only when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured.
- If `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent, the runtime keeps the MS-021B static fail-closed not_configured sentinel.
- Auth sessions use an opaque server-side session stored behind Redis and an HttpOnly `SameSite=Lax` cookie scoped to `/`.
- Login clears the historical `Path=/admin-auth` cookie, and logout clears both `Path=/` and `Path=/admin-auth`.
- The authenticated operations dashboard uses `GET /admin-api/operations/summary` and `GET /admin-api/operations/drilldown` with the same cookie-based session.
- No Agent key, `X-Agent-Key`, Tenant bearer token, JWT, refresh token, database URL, cookie secret, or production secret belongs in the browser.
- The health dashboard and read-only operations overview are inside the protected shell and unlock only when `/admin-auth/session` returns `authenticated: true`.
- Authenticated session status includes a session-bound `csrfToken` for exact admin write actions only. The browser keeps it in memory and sends it only as `X-Admin-CSRF`.
- Health transport remains credential-free and still uses only `/status-api/health/live` and `/status-api/health/ready`.
- Business admin writes, Tenant data, feed administration, roles, raw logs, raw feed URL paths, entry content, and privileged write data remain out of scope.

## Browser Contract

```text
GET  /admin-auth/session
POST /admin-auth/login
POST /admin-auth/logout
GET  /admin-api/operations/summary
GET  /admin-api/operations/drilldown
```

Requests are relative same-origin requests with `cache: "no-store"` and no custom credential headers. The client uses browser cookie semantics only for the HttpOnly session cookie; it does not read or write cookies directly and does not use localStorage, sessionStorage, IndexedDB, cookieStore, or document.cookie.

The operations summary is GET-only, aggregate-only, and manually refreshable. It must not expose tenant identifiers, feed URLs, entry content, raw feed content, raw logs, raw request/response bodies, upstream origins, password hashes, session secrets, cookies, Agent keys, Tenant tokens, or database/Redis URLs.

The operations drilldown is GET-only, bounded by `maxRows=20`, and manually refreshable with no polling. It renders safe fields only: opaque `displayId`, safe `displayName`, public `sourceHost`, statuses, counts, timestamps, safe notes, and `capabilities`. It must not expose raw feed URL paths or queries, entry content, raw logs, raw request/response bodies, private hostnames, password hashes, session secrets, cookies, Agent key values, Tenant bearer tokens, JWT claims, localStorage, sessionStorage, IndexedDB, cookieStore, document.cookie, or database/Redis URLs. No production deployment was performed by Codex for MS-025B-R1.

The feed recheck action is `POST /admin-api/operations/feed-recheck-requests`.
It is exact-route only, JSON only, CSRF-protected with `X-Admin-CSRF`,
idempotency-protected with `X-Admin-Idempotency-Key`, cooldown bounded, and
requires explicit confirmation. It uses an opaque `actionRef` from drilldown and
requests the existing due-feed path with no synchronous external feed fetch.
It must not expose raw feed URLs, internal database IDs, Agent keys, Tenant
bearer tokens, CSRF tokens, idempotency keys, cookies, stack traces, or raw
logs. No production deployment was performed by Codex for MS-026A.

## Future Production Gates

Production activation remains separate operator-authorized work. Before deployment, operators must provision production secrets, configure the production edge, prove TLS/routing, build and pin an immutable frontend image, and collect post-deploy evidence. MS-022A does not weaken accepted backend production evidence and does not change Tenant or Agent credential boundaries.
