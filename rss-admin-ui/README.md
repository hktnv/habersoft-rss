# rss-admin-ui

`rss-admin-ui` is the React/Vite admin UI project for the Habersoft RSS repository.

Status: `MS-023C_STATUS_API_PRODUCTION_NETWORK_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

## Scope

Included through MS-023C:

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
- same-origin admin session routes at `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`,
- static fail-closed auth sentinel when `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent,
- exact-route auth proxy when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured,
- protected login/session/logout UI,
- frontend auth/session boundary verifier,
- auth-session sentinel runtime harness,
- auth proxy runtime harness,
- local full-stack auth acceptance harness,
- secretless admin auth production activation package,
- local production-mode RC acceptance harness,
- production activation package verifier,
- operator-managed production package verifier,
- production upstream contract verifier,
- status-api upstream remediation harness,
- status-api production networking harness,
- secretless operator env template,
- backend-network production Compose overlay,
- operator handoff docs for a future no-secret production activation milestone.

Not included:

- business pages,
- production login/session activation,
- production credential provisioning,
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
npm run test:auth-session-sentinel
npm run test:auth-proxy
npm run test:proxy-security
npm run test:status-api-upstream-remediation
npm run test:status-api-production-networking
npm run test:fullstack
npm run test:production-mode-rc
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:auth-boundary
npm audit --omit=dev
```

## Runtime Config

Docker runtime config is supplied through:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only and must be an absolute HTTP(S) internal backend origin without userinfo, path, query, or fragment. It must be reachable from inside the admin UI proxy runtime and must not be a public edge hostname such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package it must also not use `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`; those names refer to the admin UI container or an unspecified local address, not the backend host loopback. No secret belongs in the frontend bundle or runtime config. The dashboard does not render the upstream origin; it shows only the non-secret environment label and current browser-observed health state.

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is also server-only and optional. When absent, `/admin-auth/**` stays in static fail-closed mode. When present, only `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` are proxied upstream. When enabled in production it must use the same internal backend origin class as health, not the public backend edge.

## Health Dashboard

The dashboard performs one initial observation and then requires manual refresh. It reads only:

```text
GET /status-api/health/live
GET /status-api/health/ready
```

The frontend runtime maps those routes to `/health/live` and `/health/ready` on `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Requests use `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, and no auth, cookie, bearer, Tenant, or Agent credential. It stores no browser history in localStorage, sessionStorage, IndexedDB, or cookies.

## Admin Auth Boundary

MS-022A adds a local/tested admin auth/session foundation. Backend auth defaults to `ADMIN_UI_AUTH_MODE=disabled`, has no default credential, and requires explicit synthetic/local or future production-provisioned values before `single_admin` mode can run. Sessions are server-side and use an HttpOnly `SameSite=Lax` cookie scoped to `/admin-auth`. No Agent key, Tenant bearer token, JWT, refresh token, cookie secret, private key, or privileged business data belongs in the browser. Future business admin features and production activation require separate authority.

MS-022B prepares the activation package without activating production. Backend helpers generate or validate PBKDF2 admin password hashes, generate or validate session secrets, and verify production-like admin auth env without printing secret values. The local RC harness uses only synthetic credentials and actual local Docker runtime components.

MS-023A-R2 keeps production activation out of scope and makes the production package explicitly operator-managed. Rollback baseline is operator-managed, server deployment/configuration is operator-managed, and this repository package is validated locally with synthetic credentials only.

MS-023B keeps production mutation out of scope and remediates the operator-reported public-edge status-api blocker. MS-023C keeps production mutation out of scope and remediates the operator-reported container-loopback upstream misconfiguration. In the production Docker bridge package, do not use `http://127.0.0.1:3200`, `localhost`, `::1`, `[::1]`, or `0.0.0.0` for admin UI upstream origins. Prefer backend-network mode with `compose.backend-network.yaml`, `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`, and `http://<backend_service_or_alias>:3000`. The repository backend production Compose service is `main-service-api` and its container port is `3000`. Use `http://host.docker.internal:3200` only after an operator-run container-side reachability check proves that the backend port is reachable through host-gateway. Admin UI full production acceptance remains pending until the operator applies the network fix and verifies `/status-api/health/ready`.

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

MS-023C local rehearsal commands:

```bash
docker build -t rss-admin-ui:ms023c-local .
npm run test:auth-session-sentinel
npm run test:auth-proxy
npm run test:proxy-security
npm run test:status-api-upstream-remediation
npm run test:status-api-production-networking
npm run test:fullstack
npm run test:production-mode-rc
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:auth-boundary
```

## Docs

- [Production guide](PRODUCTION.md)
- [API/auth contract](.docs/api-auth-contract.md)
- [Admin auth/session boundary](.docs/admin-auth-session-boundary.md)
- [Admin session sentinel](.docs/admin-session-sentinel.md)
- [Production activation readiness contract](.docs/production-activation-readiness.md)
- [Production activation package](.docs/production-activation-package.md)
- [Status-api upstream remediation](.docs/status-api-upstream-remediation.md)
- [Admin auth production operator handoff](.docs/admin-auth-production-operator-handoff.md)
- [Read-only status dashboard contract](.docs/read-only-status-dashboard.md)
- [Same-origin health transport contract](.docs/same-origin-health-transport.md)
