# rss-admin-ui API/Auth Contract

`rss-admin-ui` is intended to become a Tenant/admin-facing browser UI for Habersoft RSS.

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

## Write Boundary

API writes are out of scope. Any future mutation flow requires its own milestone, tests, audit contract, and production authorization.

## Deferred Decisions

CORS, cookie, bearer-token storage, refresh behavior, logout semantics, and business API transport require a later bounded vertical slice. Do not hardcode fake production auth or store real tokens in this foundation.

Production edge activation is also deferred. A future deployment must configure DNS/TLS/OpenLiteSpeed or equivalent edge routing and verify it without changing the backend API contract in this milestone.
