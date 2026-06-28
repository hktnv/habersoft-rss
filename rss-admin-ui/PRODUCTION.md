# rss-admin-ui Production Guide

Status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation, but no production deployment is performed.

Historical note: MS-020B supersedes the MS-020A `FOUNDATION_ONLY` state. `FOUNDATION_ONLY` is not the current frontend status token.

## Runtime Boundary

`rss-admin-ui` serves static assets, writes a bounded `env-config.js` file at container start, and renders an Nginx config for two exact same-origin health routes. Required runtime settings are:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only. It must be an absolute HTTP(S) origin with no userinfo, path, query, fragment, shell metacharacters, or production default. It is not written to browser `env-config.js`, static assets, HTML, or UI output. The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is server-only and optional. If absent, `/admin-auth/**` stays in the MS-021B static fail-closed not_configured mode. If present, only `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` are proxied to the configured origin. Unknown auth paths return `404`; wrong methods return `405`; query strings are stripped.

The read-only dashboard observes only same-origin `GET /status-api/health/live` and `GET /status-api/health/ready`, mapped by the frontend runtime to backend `/health/live` and `/health/ready`. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full transport contract is [.docs/same-origin-health-transport.md](.docs/same-origin-health-transport.md).

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). Status tokens remain `PRODUCTION_MUTATION_NOT_PERFORMED` and `ADMIN_UI_NOT_DEPLOYED`.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. The current implementation still exposes no privileged business data and no admin write controls. Business admin features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, server-only origins, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`.

## Deployment Boundary

MS-022A does not deploy this UI and does not activate `rss-panel.habersoft.com`.

MS-022A does not validate production edge/DNS/TLS/OpenLiteSpeed routing from the frontend container. Backend CORS, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

Before any future deployment:

- decide Tenant/admin browser auth and session handling,
- provision production admin auth secrets and set `ADMIN_UI_AUTH_MODE` deliberately,
- validate production edge routing and container-to-backend health reachability,
- validate future CORS/cookie/token behavior only for a separately authorized authenticated slice,
- build and verify an immutable image,
- configure OpenLiteSpeed/TLS separately,
- run frontend production evidence gates,
- complete the MS-020D operator authority record and future post-deploy evidence checklist.

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:auth-boundary
npm run test:auth-session-sentinel
npm run test:auth-proxy
```

## Rollback Boundary

Rollback is image-based once a future deployment exists. There is no active frontend production runtime to roll back in MS-022A.
