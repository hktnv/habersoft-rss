# rss-admin-ui Production Guide

Status: `MS-023A-R2_OPERATOR_MANAGED_PRODUCTION_PACKAGE_READY - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation. MS-022B adds the secretless production activation package, local production-mode RC acceptance, and operator handoff docs for a later authorized milestone. MS-023A-R2 prepares the operator-managed production configuration/proxy package and runbook guidance, but no production deployment is performed.

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

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). The MS-023A-R2 operator-managed production package and operator handoff are [.docs/production-activation-package.md](.docs/production-activation-package.md) and [.docs/admin-auth-production-operator-handoff.md](.docs/admin-auth-production-operator-handoff.md). Status tokens remain `PRODUCTION_MUTATION_NOT_PERFORMED` and `ADMIN_UI_NOT_DEPLOYED`.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. The current implementation still exposes no privileged business data and no admin write controls. Business admin features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. MS-022B documents the backend production activation env variables `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE`, plus frontend server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, server-only origins, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`. The secretless operator env template is [`deploy/production/operator-managed.env.template`](deploy/production/operator-managed.env.template); filled copies are operator-owned runtime secrets/config and must not be committed.

## Deployment Boundary

MS-022A/MS-022B/MS-023A-R2 do not deploy this UI and do not activate `rss-panel.habersoft.com`.

MS-023A-R2 validates only a local production-mode release candidate with synthetic credentials and the operator-managed package verifier. It performs no production deployment, no production contact, no registry publication, no Git tag, no GitHub Release, no PR, no DNS/TLS/OpenLiteSpeed mutation, no rollback-baseline capture, and no real secret provisioning. Backend CORS, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

Before any future operator-managed deployment:

- confirm operator authority for server-side mutation,
- capture the rollback baseline as an operator action before mutation,
- confirm server access, current Git SHA, image identity policy, current state checks, and backup/current-state evidence required by the backend guide,
- provision production admin auth secrets outside Git and set `ADMIN_UI_AUTH_MODE` deliberately,
- validate production edge routing and container-to-backend health reachability,
- validate cookie behavior without broadening CORS,
- build and verify an immutable image,
- configure OpenLiteSpeed/TLS/DNS/firewall separately,
- run frontend production evidence gates,
- complete the MS-020D operator authority record and future post-deploy evidence checklist.

Operator secretless preparation commands:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config -- --synthetic --require-enabled
```

Run those from `rss-habersoft-com`. The hash and secret helpers redact by default; operators intentionally emitting sensitive output must do so only in a controlled operator terminal and place values directly into an untracked runtime secret store. Do not paste real values into docs, Git, shell transcripts, browser assets, or public runtime config.

Server-side application is operator-managed. Conceptually, the operator places backend admin auth variables into the backend runtime env, places frontend runtime variables from the secretless template into the admin UI runtime env, uses the production Compose/proxy templates, binds the admin UI to loopback only, and points the external edge to that loopback route. These are human/operator steps, not Codex-executed steps in MS-023A-R2.

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run test:production-mode-rc
npm run verify:auth-boundary
npm run test:auth-session-sentinel
npm run test:auth-proxy
```

## Rollback Boundary

Rollback is image/env/edge based once a future deployment exists. Rollback baseline is operator-managed and must be captured before operator-side server mutation. Codex does not capture or infer rollback baseline in MS-023A-R2. Rollback commands are environment-specific and must be operator-confirmed; this guide provides placeholders/checklists only and does not assert an actual baseline exists.

## Future Acceptance Checklist

A future operator or separately authorized deploy milestone must prove, with redacted evidence:

- panel root serves the static app;
- `/status-api/health/live` and `/status-api/health/ready` return bounded safe statuses through the panel origin;
- unauthenticated protected shell remains blocked;
- login/session/logout works through same-origin `/admin-auth/*`;
- auth cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/admin-auth`, and `Secure` under TLS;
- browser assets and `env-config.js` contain no upstream origin, password, password hash, session secret, Agent key, Tenant bearer token, database URL, Redis credential, or private key;
- no CORS broadening was introduced;
- rollback route remains available if acceptance fails.

## Claim Boundary

MS-023A-R2 prepares the operator-managed repository package only. The admin UI remains `NOT_DEPLOYED`; live production acceptance and production activation evidence are future work.
