# rss-admin-ui

`rss-admin-ui` is the React/Vite admin UI project for the Habersoft RSS repository.

Status: `MS-021A_ADMIN_AUTH_BOUNDARY_FOUNDATION - NOT_DEPLOYED`.

## Scope

Included through MS-021A:

- application shell,
- root route,
- runtime environment-label adapter,
- error boundary,
- accessibility-oriented semantic shell,
- read-only status dashboard,
- public health client for `/status-api/health/live` and `/status-api/health/ready`,
- exact-route same-origin health proxy in the frontend Nginx runtime,
- runtime validation for liveness/readiness payloads and dependency states,
- manual refresh with stale-result suppression,
- unit tests,
- production build,
- static Docker runtime,
- production deployment template,
- production activation readiness contract,
- local production readiness verifier,
- fail-closed protected admin/business shell foundation,
- frontend auth/session boundary verifier.

Not included:

- business pages,
- login/session implementation,
- real credential exchange,
- Agent authentication,
- backend writes,
- automatic polling or monitoring history,
- production evidence projection,
- production deployment.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:production-readiness
npm run verify:auth-boundary
npm audit --omit=dev
```

## Runtime Config

Docker runtime config is supplied through:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only and must be an absolute HTTP(S) origin without userinfo, path, query, or fragment. No secret belongs in the frontend bundle or runtime config. The dashboard does not render the upstream origin; it shows only the non-secret environment label and current browser-observed health state.

## Health Dashboard

The dashboard performs one initial observation and then requires manual refresh. It reads only:

```text
GET /status-api/health/live
GET /status-api/health/ready
```

The frontend runtime maps those routes to `/health/live` and `/health/ready` on `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Requests use `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, and no auth, cookie, bearer, Tenant, or Agent credential. It stores no browser history in localStorage, sessionStorage, IndexedDB, or cookies.

## Admin Auth Boundary

The protected admin/business shell is present but blocked and unconfigured. `REAL_AUTH_NOT_IMPLEMENTED` and `AUTHORITY_REQUIRED_BEFORE_BUSINESS_ADMIN_FEATURES` remain active. No Agent key, Tenant bearer token, password, JWT, refresh token, cookie secret, private key, or privileged business data belongs in the browser. Future business admin features require a separate authority-backed real auth/session milestone.

## Docker

Local image build:

```bash
docker build -t rss-admin-ui:0.1.0 .
```

Container health endpoint:

```text
/healthz
```

Local root Compose publishes the UI on loopback port `8081`.

MS-020D local rehearsal commands:

```bash
docker build -t rss-admin-ui:ms020d-local .
npm run test:proxy-security
npm run test:fullstack
npm run verify:production-readiness
npm run verify:auth-boundary
```

## Docs

- [Production guide](PRODUCTION.md)
- [API/auth contract](.docs/api-auth-contract.md)
- [Admin auth/session boundary](.docs/admin-auth-session-boundary.md)
- [Production activation readiness contract](.docs/production-activation-readiness.md)
- [Read-only status dashboard contract](.docs/read-only-status-dashboard.md)
- [Same-origin health transport contract](.docs/same-origin-health-transport.md)
