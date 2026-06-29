# rss-admin-ui Production Guide

Status: `MS-023C_STATUS_API_PRODUCTION_NETWORK_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation. MS-022B adds the secretless production activation package, local production-mode RC acceptance, and operator handoff docs for a later authorized milestone. MS-023A-R2 prepares the operator-managed production configuration/proxy package and runbook guidance. MS-023B remediates the operator-reported public-edge status-api upstream blocker. MS-023C remediates the operator-reported production Docker bridge container-loopback upstream misconfiguration. No production deployment is performed by Codex.

Historical note: MS-020B supersedes the MS-020A `FOUNDATION_ONLY` state. `FOUNDATION_ONLY` is not the current frontend status token.

## Runtime Boundary

`rss-admin-ui` serves static assets, writes a bounded `env-config.js` file at container start, and renders an Nginx config for two exact same-origin health routes. Required runtime settings are:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only. It must be an absolute HTTP(S) internal backend origin with no userinfo, path, query, fragment, shell metacharacters, or production default. It must be reachable from inside the admin UI proxy runtime and must not point to public Habersoft edge hostnames such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package it must not use container-local or unspecified hosts such as `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`. It is not written to browser `env-config.js`, static assets, HTML, or UI output. The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is server-only and optional. If absent, `/admin-auth/**` stays in the MS-021B static fail-closed not_configured mode. If present, only `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` are proxied to the configured origin. In production it must use an internal backend origin from the same topology decision as health, not the public backend edge. Unknown auth paths return `404`; wrong methods return `405`; query strings are stripped.

The read-only dashboard observes only same-origin `GET /status-api/health/live` and `GET /status-api/health/ready`, mapped by the frontend runtime to backend `/health/live` and `/health/ready`. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full transport contract is [.docs/same-origin-health-transport.md](.docs/same-origin-health-transport.md).

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). The MS-023C operator-managed production package, status-api production networking runbook, and operator handoff are [.docs/production-activation-package.md](.docs/production-activation-package.md), [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md), and [.docs/admin-auth-production-operator-handoff.md](.docs/admin-auth-production-operator-handoff.md). Status tokens remain `PRODUCTION_MUTATION_NOT_PERFORMED` and `ADMIN_UI_NOT_DEPLOYED`.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. The current implementation still exposes no privileged business data and no admin write controls. Business admin features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. MS-022B documents the backend production activation env variables `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE`, plus frontend server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, server-only origins, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`. Preferred backend-network mode adds [`deploy/production/compose.backend-network.yaml`](deploy/production/compose.backend-network.yaml) and requires operator-provided `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`. The secretless operator env template is [`deploy/production/operator-managed.env.template`](deploy/production/operator-managed.env.template); filled copies are operator-owned runtime secrets/config and must not be committed.

## Deployment Boundary

MS-022A/MS-022B/MS-023A-R2/MS-023B/MS-023C do not deploy this UI and do not activate `rss-panel.habersoft.com`.

MS-023C validates only local synthetic upstream contracts, a local production-mode release candidate, and local Docker harnesses. It performs no production deployment, no production contact, no registry publication, no Git tag, no GitHub Release, no PR, no DNS/TLS/OpenLiteSpeed mutation, no rollback-baseline capture, and no real secret provisioning. Backend CORS, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

Before any future operator-managed deployment:

- confirm operator authority for server-side mutation,
- capture the rollback baseline as an operator action before mutation,
- confirm server access, current Git SHA, image identity policy, current state checks, and backup/current-state evidence required by the backend guide,
- provision production admin auth secrets outside Git and set `ADMIN_UI_AUTH_MODE` deliberately,
- validate production edge routing and internal container-to-backend health/auth reachability,
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

## Current Status-API Upstream Blocker

Bounded status: `OPERATOR_DEPLOYED_HEALTHZ_VERIFIED_STATUS_API_BLOCKED`.

The operator reported that the server checkout pulled MS-023B, backend host-loopback readiness at `http://127.0.0.1:3200/health/ready` returns `postgres=up`, `redis=up`, and `tenantAuth=up`, admin UI `/healthz` works on `http://127.0.0.1:8081/healthz` and `https://rss-panel.habersoft.com/healthz`, but public `https://rss-panel.habersoft.com/status-api/health/ready` still returns `502` after setting both admin UI upstreams to `http://127.0.0.1:3200`.

Diagnosis: the production admin UI runs in a normal Docker bridge container. Inside that container, `127.0.0.1`, `localhost`, `::1`, `[::1]`, and `0.0.0.0` are container-local or unspecified addresses, not the production host loopback where the backend is published. This is a container-loopback upstream misconfiguration.

Preferred operator-managed fix:

```text
ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
```

Use the backend-network overlay:

```bash
docker compose --env-file <operator-env> \
  -f rss-admin-ui/deploy/production/compose.yaml \
  -f rss-admin-ui/deploy/production/compose.backend-network.yaml \
  up -d --force-recreate
```

The backend production Compose service name in this repository is `main-service-api` and its container port is `3000`; the actual external Docker network name remains operator-selected and must not be guessed in Git.

Do not use:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=https://rss.habersoft.com
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200
```

Host-gateway mode with `http://host.docker.internal:3200` is allowed only after an operator-run check from inside a container proves reachability through Docker host-gateway. It is not guaranteed when the backend is bound only to host loopback.

Detailed runbook: [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md).

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run test:status-api-production-networking
npm run test:production-mode-rc
npm run test:status-api-upstream-remediation
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

MS-023C prepares the operator-managed repository remediation package only. The admin UI remains `NOT_DEPLOYED`; Admin UI full production acceptance remains pending unless live `/status-api/health/ready` is verified after the operator-managed production networking fix.
