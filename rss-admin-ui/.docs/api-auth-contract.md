# rss-admin-ui API/Auth Contract

`rss-admin-ui` is intended to become a Tenant/admin-facing browser UI for Habersoft RSS.

MS-020B implements only the read-only public health dashboard:

- data source is limited to public `GET /health/live` and `GET /health/ready`,
- fetch uses `credentials: "omit"` and sends no auth, cookie, bearer, Tenant, or Agent credential,
- no login route or session implementation exists,
- no backend write operation exists,
- no production deployment is performed,
- no token persistence exists.

The full dashboard contract is documented in [read-only-status-dashboard.md](read-only-status-dashboard.md).

## Backend API Base URL

The UI accepts a non-secret API base URL through build-time Vite config or runtime `env-config.js`. Local default:

```text
http://localhost:3000
```

Production values must be supplied by deployment configuration. They must not include credentials.

## Auth Boundary

Public health observation is the only anonymous browser API use accepted by MS-020B. The browser UI must not use `AGENT_KEY`, `Authorization`, cookies, bearer tokens, Tenant tokens, or embedded backend secrets for this slice.

Future Tenant/admin business pages still require a separate bounded auth/session contract. Existing Tenant API bearer semantics are not changed by MS-020B. Agent authentication remains server/agent-only and forbidden in the browser.

## Write Boundary

API writes are out of scope. Any future mutation flow requires its own milestone, tests, audit contract, and production authorization.

## Deferred Decisions

CORS, cookie, bearer-token storage, refresh behavior, and logout semantics require a later bounded vertical slice. Do not hardcode fake production auth or store real tokens in this foundation.

Production browser transport is also deferred. A future deployment must provide same-origin reverse proxying or an explicit narrow non-credentialed CORS allowlist without changing the backend API contract in this milestone.
