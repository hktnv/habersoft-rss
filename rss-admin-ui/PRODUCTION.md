# rss-admin-ui Production Guide

Status: `FOUNDATION_ONLY - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. It is a reusable template only in MS-020A; no production deployment is performed.

## Runtime Boundary

`rss-admin-ui` serves static assets and writes a bounded `env-config.js` file at container start. The only required runtime API setting is:

```text
ADMIN_UI_API_BASE_URL
```

The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value and loopback-only host port `8081`.

## Deployment Boundary

MS-020A does not deploy this UI and does not activate `rss-panel.habersoft.com`.

Before any future deployment:

- implement a bounded read-only vertical slice,
- decide Tenant/admin browser auth and session handling,
- validate CORS/cookie/token behavior,
- build and verify an immutable image,
- configure OpenLiteSpeed/TLS separately,
- run frontend production evidence gates.

## Rollback Boundary

Rollback is image-based once a future deployment exists. There is no active frontend production runtime to roll back in MS-020A.
