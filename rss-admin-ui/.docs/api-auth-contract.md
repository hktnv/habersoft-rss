# rss-admin-ui API/Auth Contract

`rss-admin-ui` is intended to become a Tenant/admin-facing browser UI for Habersoft RSS.

MS-021B status: `REAL_AUTH_NOT_IMPLEMENTED - SAME_ORIGIN_AUTH_SENTINEL_ONLY - NOT_DEPLOYED`.

MS-020C implements only the read-only public health dashboard with same-origin health transport:

- browser routes are limited to `GET /status-api/health/live` and `GET /status-api/health/ready`,
- the frontend runtime maps only those routes to backend `GET /health/live` and `GET /health/ready`,
- fetch uses `credentials: "omit"` and sends no auth, cookie, bearer, Tenant, or Agent credential,
- no login route or session implementation exists,
- no backend write operation exists,
- no production deployment is performed,
- no token persistence exists.

The dashboard contract is documented in [read-only-status-dashboard.md](read-only-status-dashboard.md). The transport contract is documented in [same-origin-health-transport.md](same-origin-health-transport.md).

## Health Transport Config

The health slice does not use a browser-visible API base URL after MS-020C. The server-only runtime value is:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
```

It must be an absolute HTTP(S) origin with no userinfo, path, query, or fragment. It must not contain credentials and must not be written to browser `env-config.js`. `ADMIN_UI_API_BASE_URL` is not used by this health slice; future non-health browser API work requires a separate bounded contract.

## Auth Boundary

Public health observation is the only anonymous browser API use accepted by MS-020C. The browser UI must not use `AGENT_KEY`, `Authorization`, cookies, bearer tokens, Tenant tokens, or embedded backend secrets for this slice.

Future Tenant/admin business pages still require a separate bounded auth/session contract. Existing Tenant API bearer semantics are not changed by MS-020B. Agent authentication remains server/agent-only and forbidden in the browser.

MS-021A adds only a fail-closed protected admin/business shell foundation. The shell defaults to blocked/unconfigured, does not render privileged content, does not create fake user identity, and does not implement real auth/session. See [admin-auth-session-boundary.md](admin-auth-session-boundary.md).

MS-021B adds a local/static same-origin admin session sentinel contract:

- browser path: `GET /admin-auth/session`,
- current runtime result: HTTP `501` not_configured sentinel with `authenticated: false`,
- no upstream proxy, backend route, CORS change, credential exchange, browser credential persistence, or production deployment,
- unavailable, invalid, timeout, redirect, HTML, and authenticated-looking responses fail closed.

The sentinel is documented in [admin-session-sentinel.md](admin-session-sentinel.md). It is a replacement point for future real auth, not real auth itself.

Before any real admin/business feature, a future milestone must define browser session authority, cookie versus bearer policy, token storage policy, CSRF/XSS stance, refresh/logout semantics, same-origin edge and CORS stance, Tenant/admin identity boundary, role/permission model, safe public versus authenticated fields, backend route inventory, and production activation evidence.

## Write Boundary

API writes are out of scope. Any future mutation flow requires its own milestone, tests, audit contract, and production authorization.

## Deferred Decisions

CORS, cookie, bearer-token storage, refresh behavior, logout semantics, and business API transport require a later bounded vertical slice. Do not hardcode fake production auth or store real tokens in this foundation.

Production edge activation is also deferred. A future deployment must configure DNS/TLS/OpenLiteSpeed or equivalent edge routing and verify it without changing the backend API contract in this milestone.
