# rss-admin-ui

`rss-admin-ui` is the foundation-only React/Vite admin UI project for the Habersoft RSS repository.

Status: `FOUNDATION_ONLY - NOT_DEPLOYED`.

## Scope

Included in MS-020A:

- application shell,
- root route,
- runtime/build-time API base URL adapter,
- error boundary,
- accessibility-oriented semantic shell,
- unit tests,
- production build,
- static Docker runtime,
- production deployment template.

Not included:

- business pages,
- login/session implementation,
- Agent authentication,
- backend writes,
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

No secret belongs in the frontend bundle or runtime config.

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
