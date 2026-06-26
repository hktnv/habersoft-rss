# Read-only Status Dashboard Contract

Status: `READ_ONLY_STATUS_DASHBOARD_IMPLEMENTED - NOT_DEPLOYED`.

This document is the as-built MS-020B contract for the first `rss-admin-ui` product slice. It describes the local, tested frontend behavior only. It is not production deployment evidence and does not activate `rss-panel.habersoft.com`.

## Persona

Primary persona: a Habersoft RSS operator/admin who needs a quick, read-only current-state view of the configured backend health surface.

This persona does not imply that an authenticated admin account, login route, browser session, or Tenant business UI exists in MS-020B.

## Data Source

The dashboard uses only the existing public backend health routes:

- `GET <configured-api-base>/health/live`
- `GET <configured-api-base>/health/ready`

The current backend contract is:

- liveness: JSON object with `status: "live"` and HTTP `200`.
- readiness healthy: JSON object with `status: "ready"` and dependencies `postgres`, `redis`, `tenantAuth`, each `up` or `down`, and HTTP `200`.
- readiness not ready: JSON object with `status: "not_ready"` and the same dependency keys, returned as HTTP `503`.

No backend route, DTO, CORS setting, Prisma file, production Compose file, or evidence tool was changed for MS-020B.

## Displayed Information

The dashboard displays only:

- overall observed state,
- liveness state,
- readiness state,
- PostgreSQL, Redis, and Tenant auth readiness states when a valid readiness response is available,
- configured non-secret environment label,
- client-side last checked time after a completed observation,
- bounded user-safe messages for loading, degraded, unavailable, and partial states.

The dashboard does not display full API URLs, secrets, JWT claims, tenant IDs, connection strings, internal container names, raw response bodies, stack traces, commit/image identity, production receipts, uptime percentages, incident history, feed counts, tenant counts, Agent runtime details, or deployment success.

## Freshness

The page performs one initial observation on load. After that, refresh is explicit and manual.

MS-020B does not implement automatic polling, background monitoring, browser-persisted history, localStorage, sessionStorage, IndexedDB, cookie persistence, or evidence projection. `Last checked` is the browser observation completion time, not server authority.

## Auth and Session Boundary

This slice is anonymous only for public health observation. It does not implement:

- login,
- session creation,
- bearer tokens,
- `Authorization` header,
- `AGENT_KEY`,
- cookie credentials,
- token refresh,
- browser token storage.

The health client uses `GET`, `Accept: application/json`, `credentials: "omit"`, and `cache: "no-store"`. Agent authentication remains forbidden in the browser. Tenant/admin business pages still require a future bounded auth/session contract.

## CORS and Transport Finding

Read-only inspection of the backend source found no backend browser CORS enablement in the API bootstrap. Health routes are public and unauthenticated, but MS-020B does not validate a production browser transport path.

Future production deployment must provide one of:

- same-origin reverse proxying for the admin UI and backend health routes, or
- an explicit, narrow, non-credentialed browser CORS allowlist.

MS-020B does not add wildcard production CORS, credentialed CORS, backend CORS mutation, DNS/TLS/reverse-proxy mutation, or a frontend generic proxy.

## UI State Semantics

- `unknown`: no completed observation exists yet.
- `loading`: first observation is in progress.
- `refreshing`: a manual or replacement observation is in progress while the previous completed observation remains visibly marked as previous.
- `healthy`: liveness is valid, readiness is valid, and all documented dependencies are `up`.
- `degraded`: liveness is valid, but readiness is `not_ready` or at least one documented dependency is `down`.
- `unavailable`: liveness cannot be safely established because of network failure, timeout, abort, unexpected HTTP status, malformed JSON, or invalid payload.
- `partial`: liveness is valid, but readiness cannot be validated into a complete public contract observation.

Older observations are not allowed to overwrite newer observations. A failed refresh becomes the current completed observation instead of silently preserving stale healthy data.

## Validation

The frontend contract is covered by focused Vitest tests for:

- URL construction for `/health/live` and `/health/ready`,
- GET-only fetch options,
- omitted credentials and no auth/cookie/Agent key headers,
- valid, malformed, invalid, non-2xx, readiness failure, timeout, and abort cases,
- safe error normalization,
- loading, healthy, degraded, unavailable, partial, manual refresh, busy state, stale result suppression, last checked behavior, no browser persistence, accessible labels, and neutral environment labels.

Production deployment remains out of scope for this milestone.
