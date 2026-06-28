# Admin Auth Session Boundary

Status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

MS-022A adds a local/tested same-origin admin auth/session foundation. It does not deploy `rss-admin-ui`, does not activate `rss-panel.habersoft.com`, does not mutate production edge/DNS/TLS/OpenLiteSpeed, and does not publish an image, tag, release, or registry artifact.

## Current Boundary

- Backend admin auth is disabled by default with `ADMIN_UI_AUTH_MODE=disabled`.
- There is no default admin credential. `single_admin` mode requires `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, and `ADMIN_UI_SESSION_SECRET`.
- The browser uses only same-origin `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`.
- The frontend runtime proxies those auth paths only when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured.
- If `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent, the runtime keeps the MS-021B static fail-closed not_configured sentinel.
- Auth sessions use an opaque server-side session stored behind Redis and an HttpOnly `SameSite=Lax` cookie scoped to `/admin-auth`.
- No Agent key, `X-Agent-Key`, Tenant bearer token, JWT, refresh token, database URL, cookie secret, or production secret belongs in the browser.
- The health dashboard is inside the protected shell and unlocks only when `/admin-auth/session` returns `authenticated: true`.
- Health transport remains credential-free and still uses only `/status-api/health/live` and `/status-api/health/ready`.
- Business admin writes, Tenant data, feed administration, roles, and privileged business metrics remain out of scope.

## Browser Contract

```text
GET  /admin-auth/session
POST /admin-auth/login
POST /admin-auth/logout
```

Requests are relative same-origin requests with `cache: "no-store"` and no custom credential headers. The client uses browser cookie semantics only for the HttpOnly session cookie; it does not read or write cookies directly and does not use localStorage, sessionStorage, IndexedDB, or cookieStore.

## Future Production Gates

Production activation remains separate operator-authorized work. Before deployment, operators must provision production secrets, configure the production edge, prove TLS/routing, build and pin an immutable frontend image, and collect post-deploy evidence. MS-022A does not weaken accepted backend production evidence and does not change Tenant or Agent credential boundaries.
