# rss-admin-ui Production Guide

Status: `READ_ONLY_STATUS_DASHBOARD_SAME_ORIGIN_REHEARSED - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-020C adds a local/tested same-origin health transport for the read-only status dashboard, but no production deployment is performed.

Historical note: MS-020B supersedes the MS-020A `FOUNDATION_ONLY` state. `FOUNDATION_ONLY` is not the current frontend status token.

## Runtime Boundary

`rss-admin-ui` serves static assets, writes a bounded `env-config.js` file at container start, and renders an Nginx config for two exact same-origin health routes. Required runtime settings are:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only. It must be an absolute HTTP(S) origin with no userinfo, path, query, fragment, shell metacharacters, or production default. It is not written to browser `env-config.js`, static assets, HTML, or UI output. The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

The read-only dashboard observes only same-origin `GET /status-api/health/live` and `GET /status-api/health/ready`, mapped by the frontend runtime to backend `/health/live` and `/health/ready`. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full transport contract is [.docs/same-origin-health-transport.md](.docs/same-origin-health-transport.md).

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, a server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`.

## Deployment Boundary

MS-020C does not deploy this UI and does not activate `rss-panel.habersoft.com`.

Production edge/DNS/TLS/OpenLiteSpeed routing and backend reachability from the frontend container are not validated by MS-020C. Backend CORS, backend routes, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

Before any future deployment:

- decide Tenant/admin browser auth and session handling,
- validate production edge routing and container-to-backend health reachability,
- validate future CORS/cookie/token behavior only for a separately authorized authenticated slice,
- build and verify an immutable image,
- configure OpenLiteSpeed/TLS separately,
- run frontend production evidence gates.

## Rollback Boundary

Rollback is image-based once a future deployment exists. There is no active frontend production runtime to roll back in MS-020C.
