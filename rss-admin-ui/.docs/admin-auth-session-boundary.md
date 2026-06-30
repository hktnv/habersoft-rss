# Admin Auth Session Boundary

Status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`.

Historical foundation status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

MS-022A adds a local/tested same-origin admin auth/session foundation. MS-025A keeps that session model and uses it for the protected read-only admin operations route. This document does not claim MS-025A live production acceptance; deployment and retest remain operator-managed.

## Current Boundary

- Backend admin auth is disabled by default with `ADMIN_UI_AUTH_MODE=disabled`.
- There is no default admin credential. `single_admin` mode requires `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, and `ADMIN_UI_SESSION_SECRET`.
- The browser uses only same-origin `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`.
- The frontend runtime proxies those auth paths only when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured.
- If `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent, the runtime keeps the MS-021B static fail-closed not_configured sentinel.
- Auth sessions use an opaque server-side session stored behind Redis and an HttpOnly `SameSite=Lax` cookie scoped to `/`.
- Login clears the historical `Path=/admin-auth` cookie, and logout clears both `Path=/` and `Path=/admin-auth`.
- The authenticated operations dashboard uses `GET /admin-api/operations/summary` with the same cookie-based session.
- No Agent key, `X-Agent-Key`, Tenant bearer token, JWT, refresh token, database URL, cookie secret, or production secret belongs in the browser.
- The health dashboard and read-only operations overview are inside the protected shell and unlock only when `/admin-auth/session` returns `authenticated: true`.
- Health transport remains credential-free and still uses only `/status-api/health/live` and `/status-api/health/ready`.
- Business admin writes, Tenant data, feed administration, roles, raw rows, raw logs, and privileged non-aggregate data remain out of scope.

## Browser Contract

```text
GET  /admin-auth/session
POST /admin-auth/login
POST /admin-auth/logout
GET  /admin-api/operations/summary
```

Requests are relative same-origin requests with `cache: "no-store"` and no custom credential headers. The client uses browser cookie semantics only for the HttpOnly session cookie; it does not read or write cookies directly and does not use localStorage, sessionStorage, IndexedDB, cookieStore, or `document.cookie`.

The operations summary is GET-only, aggregate-only, and manually refreshable. It must not expose tenant identifiers, feed URLs, entry content, raw feed content, raw logs, raw request/response bodies, upstream origins, password hashes, session secrets, cookies, Agent keys, Tenant tokens, or database/Redis URLs.

## Future Production Gates

Production activation remains separate operator-authorized work. Before deployment, operators must provision production secrets, configure the production edge, prove TLS/routing, build and pin an immutable frontend image, and collect post-deploy evidence. MS-022A does not weaken accepted backend production evidence and does not change Tenant or Agent credential boundaries.
