# rss-admin-ui API/Auth Contract

`rss-admin-ui` is intended to become a Tenant/admin-facing browser UI for Habersoft RSS.

MS-020A is foundation-only:

- no login route,
- no session implementation,
- no backend write operation,
- no production deployment,
- no token persistence.

## Backend API Base URL

The UI accepts a non-secret API base URL through build-time Vite config or runtime `env-config.js`. Local default:

```text
http://localhost:3000
```

Production values must be supplied by deployment configuration. They must not include credentials.

## Auth Boundary

The browser UI must not use `AGENT_KEY` and must not embed backend secrets. Future browser authentication must follow the accepted Tenant authentication, JWKS, and session contract. The exact login/session implementation is deferred to a later bounded vertical slice.

## Write Boundary

API writes are out of scope. Any future mutation flow requires its own milestone, tests, audit contract, and production authorization.

## Deferred Decisions

CORS, cookie, bearer-token storage, refresh behavior, and logout semantics require a later bounded vertical slice. Do not hardcode fake production auth or store real tokens in this foundation.
