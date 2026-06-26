# rss-admin-ui

`rss-admin-ui` is the React/Vite admin UI project for the Habersoft RSS repository.

Status: `READ_ONLY_STATUS_DASHBOARD_IMPLEMENTED - NOT_DEPLOYED`.

## Scope

Included through MS-020B:

- application shell,
- root route,
- runtime/build-time API base URL adapter,
- error boundary,
- accessibility-oriented semantic shell,
- read-only status dashboard,
- public health client for `/health/live` and `/health/ready`,
- runtime validation for liveness/readiness payloads and dependency states,
- manual refresh with stale-result suppression,
- unit tests,
- production build,
- static Docker runtime,
- production deployment template.

Not included:

- business pages,
- login/session implementation,
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
npm audit --omit=dev
```

## Runtime Config

Local default API base URL:

```text
http://localhost:3000
```

Docker runtime config is supplied through:

```text
ADMIN_UI_API_BASE_URL
ADMIN_UI_ENVIRONMENT_NAME
```

No secret belongs in the frontend bundle or runtime config. The dashboard does not render the full API URL; it shows only the non-secret environment label and current browser-observed health state.

## Health Dashboard

The dashboard performs one initial observation and then requires manual refresh. It reads only:

```text
GET <configured-api-base>/health/live
GET <configured-api-base>/health/ready
```

Requests use `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, and no auth, cookie, bearer, Tenant, or Agent credential. It stores no browser history in localStorage, sessionStorage, IndexedDB, or cookies.

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

## Docs

- [Production guide](PRODUCTION.md)
- [API/auth contract](.docs/api-auth-contract.md)
- [Read-only status dashboard contract](.docs/read-only-status-dashboard.md)
