# rss-admin-ui Production Guide

Status: `READ_ONLY_STATUS_DASHBOARD_IMPLEMENTED - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-020B adds a local/tested read-only status dashboard, but no production deployment is performed.

Historical note: MS-020B supersedes the MS-020A `FOUNDATION_ONLY` state. `FOUNDATION_ONLY` is not the current frontend status token.

## Runtime Boundary

`rss-admin-ui` serves static assets and writes a bounded `env-config.js` file at container start. The only required runtime API setting is:

```text
ADMIN_UI_API_BASE_URL
ADMIN_UI_ENVIRONMENT_NAME
```

The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

The read-only dashboard observes only public `GET /health/live` and `GET /health/ready` under the configured API base. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full as-built contract is [.docs/read-only-status-dashboard.md](.docs/read-only-status-dashboard.md).

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, a non-secret `ADMIN_UI_API_BASE_URL`, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`.

## Deployment Boundary

MS-020B does not deploy this UI and does not activate `rss-panel.habersoft.com`.

Production browser transport is not validated by MS-020B. A future deployment must provide either same-origin reverse proxying or an explicit narrow non-credentialed CORS allowlist for the public health routes. Backend CORS, backend routes, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

Before any future deployment:

- decide Tenant/admin browser auth and session handling,
- validate CORS/cookie/token behavior,
- build and verify an immutable image,
- configure OpenLiteSpeed/TLS separately,
- run frontend production evidence gates.

## Rollback Boundary

Rollback is image-based once a future deployment exists. There is no active frontend production runtime to roll back in MS-020B.
