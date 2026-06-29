# Same-origin Health Transport Contract

Status: `READ_ONLY_STATUS_DASHBOARD_SAME_ORIGIN_REHEARSED - NOT_DEPLOYED`.

This is the as-built MS-020C transport contract for the `rss-admin-ui` read-only status dashboard. It is local/tested delivery evidence only. It is not production deployment evidence and does not activate `rss-panel.habersoft.com`.

## Browser Routes

The browser uses only fixed relative same-origin routes:

```text
GET /status-api/health/live
GET /status-api/health/ready
```

The client sends `GET`, `Accept: application/json`, `credentials: "omit"`, `cache: "no-store"`, no request body, no `Authorization`, no `Cookie`, no bearer/Tenant token, and no `X-Agent-Key`.

## Upstream Mapping

Pattern A is selected: the frontend Nginx runtime owns the allowlisted health proxy.

Only these mappings exist:

```text
/status-api/health/live  ->  <ADMIN_UI_HEALTH_UPSTREAM_ORIGIN>/health/live
/status-api/health/ready ->  <ADMIN_UI_HEALTH_UPSTREAM_ORIGIN>/health/ready
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only runtime config. It must be an absolute `http://` or `https://` internal backend origin with a non-empty host, optional numeric port, and no userinfo, path, query, fragment, whitespace, shell metacharacters, or production default. A missing, invalid, or known public Habersoft edge value fails container startup before Nginx serves traffic.

Production upstreams must be selected by runtime topology:

```text
host namespace loopback:        http://127.0.0.1:3200
container-to-host gateway:      http://host.docker.internal:3200
same Docker network service:    http://main-service-api:3000
```

Do not configure the admin UI health upstream with the public backend edge:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
```

The upstream origin is not emitted to `env-config.js`, the JavaScript bundle, HTML, response bodies, or dashboard UI. `ADMIN_UI_API_BASE_URL` is not used by this health slice after MS-020C; future authenticated business APIs require a separate contract.

## Proxy Safety

The Nginx runtime defines two exact `location =` routes and a bounded rejecting `/status-api/` fallback. It does not expose `/api/*`, arbitrary suffix forwarding, user-controlled destinations, or business routes.

For the two health routes:

- non-GET methods return local `405`,
- unknown `/status-api/**`, duplicate-slash, suffix, and encoded traversal paths return local `404`,
- query strings are dropped before upstream forwarding,
- request bodies are not proxied,
- client request headers are not forwarded; only controlled `Host` and `Accept: application/json` are set,
- upstream `Set-Cookie` and `WWW-Authenticate` are hidden,
- upstream `401`/`403` from a public-edge-style misroute is converted to a bounded `502` with no raw diagnostic body,
- proxy connect/send/read timeouts are bounded,
- caching is disabled with `no-store`.

The frontend container `/healthz` remains local to the static runtime and is never proxied to the backend.

## Local Development And Compose

Vite dev uses the same browser paths and requires server-process `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. It configures only the two exact proxy entries and rejects non-GET or unknown `/status-api/**` paths locally.

Root local Compose wires:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000
```

This uses the actual local backend service on the Compose network and does not require backend CORS. Root Compose remains local orchestration, not production deployment.

## Validation Commands

Frontend checks:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Runtime and local rehearsal checks:

```bash
docker build -t rss-admin-ui:ms020c-local .
npm run test:proxy-security
npm run test:status-api-upstream-remediation
npm run test:fullstack
npm run verify:production-upstream-contract
```

The proxy-security harness uses a synthetic local sentinel. The full-stack acceptance uses root Compose with PostgreSQL, Redis, local JWKS fixture, the unchanged backend API/worker, and the built frontend runtime.

## Boundaries

MS-020C does not deploy the UI, publish an image, create DNS/TLS/OpenLiteSpeed routing, test production browser transport, or change backend CORS/API/source. Tenant/admin login, session, logout, refresh, bearer/cookie policy, and business API transport remain separate authority-backed milestones.
