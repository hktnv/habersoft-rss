# rss-admin-ui Production Guide

Status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation. MS-022B adds the secretless production activation package, local production-mode RC acceptance, and operator handoff docs for a later authorized milestone. MS-023A-R2 prepares the operator-managed production configuration/proxy package and runbook guidance. MS-023B remediates the operator-reported public-edge status-api upstream blocker. MS-023C remediates the operator-reported production Docker bridge container-loopback upstream misconfiguration. MS-023D records read-only live production status-dashboard transport acceptance and classifies admin auth as not configured. No production deployment is performed by Codex.

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

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). The operator-managed production package, live status-dashboard acceptance, status-api production networking runbook, and operator handoff are [.docs/production-activation-package.md](.docs/production-activation-package.md), [.docs/live-status-dashboard-acceptance.md](.docs/live-status-dashboard-acceptance.md), [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md), and [.docs/admin-auth-production-operator-handoff.md](.docs/admin-auth-production-operator-handoff.md). MS-023D status transport is accepted; authenticated admin-shell production acceptance remains blocked by `AUTH_NOT_CONFIGURED_RESIDUAL`.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. The current implementation still exposes no privileged business data and no admin write controls. Business admin features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. MS-022B documents the backend production activation env variables `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE`, plus frontend server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

Backend admin-auth variables must be applied to the backend API runtime. Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth. If `/admin-auth/session` returns HTTP `501 not_configured` while `/healthz` and `/status-api/health/*` pass, the next operator action is backend runtime admin-auth env placement plus backend API restart/recreate under the rollback plan, not continued changes to `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`.

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) expects an immutable `RSS_ADMIN_UI_IMAGE` value, server-only origins, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081`. Preferred backend-network mode adds [`deploy/production/compose.backend-network.yaml`](deploy/production/compose.backend-network.yaml) and requires operator-provided `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`. The secretless frontend runtime env template is [`deploy/production/operator-managed.env.template`](deploy/production/operator-managed.env.template). Backend auth env placement is documented separately in [`deploy/production/backend-admin-auth.env.template`](deploy/production/backend-admin-auth.env.template). Filled copies are operator-owned runtime secrets/config and must not be committed.

## Deployment Boundary

MS-022A/MS-022B/MS-023A-R2/MS-023B/MS-023C do not deploy this UI and do not activate `rss-panel.habersoft.com`. MS-023D records evidence from an already operator-managed live surface; Codex did not deploy, restart, pull, edit production env, or mutate production.

MS-023D performs only allowed public read-only GET verification for the status endpoints and admin-auth sentinel. It performs no production deployment, no write method, no cookies, no auth headers, no SSH/SCP/SFTP/rsync, no production Docker command, no registry publication, no Git tag, no GitHub Release, no PR, no DNS/TLS/OpenLiteSpeed mutation, no rollback-baseline capture, and no real secret provisioning. Backend CORS, DNS, TLS, OpenLiteSpeed, and production reverse proxy settings are not changed by this milestone.

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

Server-side application is operator-managed. Conceptually, the operator places backend admin auth variables into the backend runtime env, places frontend runtime variables from the secretless template into the admin UI runtime env, uses the production Compose/proxy templates, binds the admin UI to loopback only, and points the external edge to that loopback route. These are human/operator steps, not Codex-executed steps.

## MS-023D Live Status Dashboard Acceptance

Bounded status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`.

MS-023D accepts the read-only production status-dashboard transport from operator-reported plus Codex public read-only verified evidence:

- `https://rss-panel.habersoft.com/healthz -> 200 ok`;
- `https://rss-panel.habersoft.com/status-api/health/live -> 200, status=live`;
- `https://rss-panel.habersoft.com/status-api/health/ready -> 200, status=ready, postgres=up, redis=up, tenantAuth=up`.

`https://rss-panel.habersoft.com/admin-auth/session -> 501 not_configured` is classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. It is not a blocker for read-only status-dashboard closure. It is a blocker for authenticated admin-shell production acceptance.

The residual means backend admin auth is still disabled/not configured at the backend API runtime boundary, or the frontend auth route remains in its static fail-closed sentinel mode. Because status-api health is already accepted, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` for this residual. Verify `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` points to the internal backend origin and verify backend runtime env placement from `backend-admin-auth.env.template`.

Historical MS-023C remediation remains the correct networking reference if status-api regresses. Preferred frontend upstream topology remains:

```text
ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000
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

Detailed runbooks: [.docs/live-status-dashboard-acceptance.md](.docs/live-status-dashboard-acceptance.md) and [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md).

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
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

MS-023D accepts only the read-only status-dashboard production transport. Authenticated admin-shell production acceptance remains pending until `AUTH_NOT_CONFIGURED_RESIDUAL` is resolved through backend runtime admin-auth env placement and redacted login/session/logout evidence is accepted.
