# rss-admin-ui Production Guide

Status: `MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation. MS-022B adds the secretless production activation package, local production-mode RC acceptance, and operator handoff docs for a later authorized milestone. MS-023A-R2 prepares the operator-managed production configuration/proxy package and runbook guidance. MS-023B remediates the operator-reported public-edge status-api upstream blocker. MS-023C remediates the operator-reported production Docker bridge container-loopback upstream misconfiguration. MS-023D records read-only live production status-dashboard transport acceptance and classifies admin auth as not configured. MS-024A prepares the operator auth enablement package and same-origin proxy hardening while production admin auth remains pending operator backend runtime changes. MS-024B adds operator ergonomics, auth-smoke diagnostics, and graduated guardrails after the operator-reported latest recreate blocker. MS-024C canonicalizes backend-network overlay usage for production service-DNS upstreams, adds no-crash request-time proxy resolution for missing service DNS, and points `AUTH_NOT_CONFIGURED_RESIDUAL` to backend runtime auth activation diagnostics. MS-024D lands the backend production Compose env mapping needed for that activation path. MS-024E records operator-reported configured unauthenticated auth-session evidence after frontend helper recreate, while authenticated admin-shell acceptance remains login-smoke pending. No production deployment is performed by Codex.

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

MS-024B changes runtime failure handling from startup rejection to graduated guardrails. The static frontend, `/healthz`, and `env-config.js` start even when a server-only upstream is missing or invalid. Unsafe upstreams are still fail-closed at exact route boundaries: missing, malformed, public edge, or Docker bridge loopback upstreams return bounded JSON `502` with `invalid_upstream_origin` or `public_edge_upstream_rejected`; unreachable internal upstreams return `upstream_unavailable`; upstream `401/403` on status health returns `upstream_forbidden`; absent auth upstream preserves `501 not_configured`. Public edge and loopback upstreams do not proxy successfully. `ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION=true` can be used in strict synthetic checks if a startup failure is desired.

MS-024C keeps that fail-closed traffic policy but removes the service-DNS restart-loop symptom. Generated proxy routes use request-time upstream resolution, so a production-like container configured with `http://main-service-api:3000` but missing the backend-network attachment should still serve `/healthz`, `env-config.js`, and static assets. Exact status/auth proxy routes return bounded JSON `502` for DNS/reachability failure without exposing the raw host, resolver message, stack trace, Nginx error page, cookie, or secret.

The read-only dashboard observes only same-origin `GET /status-api/health/live` and `GET /status-api/health/ready`, mapped by the frontend runtime to backend `/health/live` and `/health/ready`. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full transport contract is [.docs/same-origin-health-transport.md](.docs/same-origin-health-transport.md).

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). The operator-managed production package, live status-dashboard acceptance, status-api production networking runbook, and operator handoff are [.docs/production-activation-package.md](.docs/production-activation-package.md), [.docs/live-status-dashboard-acceptance.md](.docs/live-status-dashboard-acceptance.md), [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md), and [.docs/admin-auth-production-operator-handoff.md](.docs/admin-auth-production-operator-handoff.md). MS-023D status transport is accepted; MS-024E auth-session status is `AUTH_CONFIGURED_UNAUTHENTICATED`; authenticated admin-shell production acceptance remains pending.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. The current implementation still exposes no privileged business data and no admin write controls. Business admin features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. MS-022B documents the backend production activation env variables `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE`, plus frontend server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

Backend admin-auth variables must be applied to the backend API runtime. Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth. If `/admin-auth/session` returns HTTP `501 not_configured` while `/healthz` and `/status-api/health/*` pass, the next operator action is backend runtime admin-auth env placement plus `main-service-api` restart/recreate under the rollback plan, not continued changes to `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`.

For MS-024D/MS-024E, placing values only in `rss-admin-ui/.env.production` is insufficient because that file is frontend runtime input, not backend API service runtime input. `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. `/admin-auth/session -> configured=true, authenticated=false, reason=unauthenticated` means backend auth is configured and awaiting login smoke. Use `deploy/production/backend-admin-auth.env.template`, the backend `production.env.template` admin-auth block, and backend verifiers before operator-side backend API restart/recreate.

## Image Contract

The production template in [`deploy/production/compose.yaml`](deploy/production/compose.yaml) accepts `habersoft-rss-frontend:latest` as an operator-managed mutable local image default only so harmless inspection commands such as `ps` and `config` work without an env file. Release candidates should still provide an immutable `RSS_ADMIN_UI_IMAGE` value through operator env. Server-only origins, a non-secret `ADMIN_UI_ENVIRONMENT_NAME`, and loopback-only host port `8081` also have inspection-safe defaults.

For production Docker bridge mode with backend service DNS, [`deploy/production/compose.backend-network.yaml`](deploy/production/compose.backend-network.yaml) is canonical runtime input, not an optional overlay. `main-service-api` resolves only when the admin UI container is attached to the backend Docker network. The recommended operator path is:

```bash
npm run production:diagnose:redacted
npm run ops:compose:config
npm run ops:compose:recreate
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
```

The helper includes `compose.backend-network.yaml` when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured. If `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` or `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` uses backend service DNS such as `http://main-service-api:3000` but the backend network is missing, the helper stops before recreate with redacted guidance. Plain `deploy/production/compose.yaml` remains valid for static inspection, config rendering, and degraded/no-upstream local scenarios; it is not the complete production runtime invocation for service-DNS upstreams.

Run `npm run ops:compose:recreate` after any backend API/image/network/admin-auth env recreate. Backend `--force-recreate` can leave the already-running frontend Nginx container with stale upstream/network references; status/auth proxy routes may return `502` or `auth_unavailable` until the frontend helper recreates the container with the backend-network overlay.

Advanced fallback direct Compose command:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  up -d --no-build --pull never --force-recreate rss-admin-ui
```

The secretless frontend runtime env template is [`deploy/production/operator-managed.env.template`](deploy/production/operator-managed.env.template). Backend auth env placement is documented separately in [`deploy/production/backend-admin-auth.env.template`](deploy/production/backend-admin-auth.env.template) and [`../rss-habersoft-com/.docs/admin-auth-production-activation.md`](../rss-habersoft-com/.docs/admin-auth-production-activation.md). Filled copies are operator-owned runtime secrets/config and must not be committed.

## Deployment Boundary

MS-022A/MS-022B/MS-023A-R2/MS-023B/MS-023C do not deploy this UI and do not activate `rss-panel.habersoft.com`. MS-023D records evidence from an already operator-managed live surface; Codex did not deploy, restart, pull, edit production env, or mutate production. MS-024A likewise performs no production deployment, no registry publication, no Git tag, and no rollback-baseline capture; rollback baseline is operator-managed.

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

## MS-024E Configured Unauthenticated Evidence Intake

Bounded status: `MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING`.

MS-024E records operator-reported evidence only; Codex did not contact or mutate production. The status-dashboard production scope remains accepted. The operator reported:

- backend MS-024D diagnostics passed with `ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT`, API env wired, and worker `worker_absent_by_design`;
- backend container loopback and host loopback `/admin-auth/session` returned `configured=true`, `authenticated=false`, `reason=unauthenticated`;
- the first frontend edge retest returned status-api `502`/auth unavailable because the frontend retained stale upstream/network references after backend recreate;
- `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` recreated the frontend with the backend-network overlay;
- after that helper recreate, `/healthz`, `/status-api/health/live`, `/status-api/health/ready`, and `/admin-auth/session` passed through the frontend edge;
- `auth-smoke:redacted` returned `AUTH_CONFIGURED_UNAUTHENTICATED` with `diagnostic_classes: []`.

`AUTH_CONFIGURED_UNAUTHENTICATED` is the expected no-cookie, pre-login state. It is not authenticated admin-shell acceptance. The next evidence required for full authenticated admin acceptance is redacted credential login smoke using only environment variables:

```bash
ADMIN_AUTH_SMOKE_USERNAME="<operator-owned>" \
ADMIN_AUTH_SMOKE_PASSWORD="<operator-owned>" \
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Report only the redacted classification, such as `AUTHENTICATED_ADMIN_ACCEPTED` or `AUTH_LOGIN_ATTEMPT_FAILED`; do not paste credentials, cookies, session IDs, password hashes, session secrets, raw logs, or raw response bodies.

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

## MS-024A Auth Enablement Package

Bounded status: `MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR`.

MS-023D status-dashboard production transport remains accepted. MS-024A adds the operator activation package needed for the remaining auth fix without claiming authenticated admin-shell production acceptance:

- `/status-api/health/live` and `/status-api/health/ready` still proxy with no credentials and now hide upstream CORS response headers in addition to `Set-Cookie` and `WWW-Authenticate`;
- `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout` hide upstream CORS response headers while preserving intended login/logout `Set-Cookie` behavior;
- backend env-file validation supports `npm run admin-auth:verify-config -- --env-file <path> --require-enabled` with redacted output and rejects placeholders, disabled mode, missing values, invalid hashes, and short session secrets;
- `npm run auth-smoke:redacted` performs a session-only classification by default and an optional `--login-smoke` only when `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` are supplied through environment variables;
- `npm run test:admin-auth-smoke-redacted` and `npm run verify:ms024a-auth-enablement-package` validate the package locally with synthetic values.

No CORS broadening is part of this package. Redacted login/session/logout evidence remains an operator-managed future acceptance input after backend runtime admin-auth env placement and `main-service-api` restart/recreate.

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:operator-ergonomics
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run test:admin-auth-smoke-redacted
npm run test:status-api-production-networking
npm run test:production-mode-rc
npm run test:status-api-upstream-remediation
npm run verify:auth-boundary
npm run test:auth-session-sentinel
npm run test:auth-proxy
```

## MS-024B operator retest checklist

Bounded status: `MS-024B_OPERATOR_ERGONOMICS_AUTH_SMOKE_REMEDIATION_READY_OPERATOR_RETEST_REQUIRED`.

This is repository remediation only. The status-dashboard scope was accepted in MS-023D, but the operator-reported latest recreate introduced a new auth/runtime blocker; no live acceptance claimed here. The authenticated admin shell remains pending until redacted auth smoke passes live.

Policy: graduated guardrails. Inspection should be easy, diagnostics should be clear, static frontend should not crash-loop for upstream mistakes, unsafe upstream traffic must still fail closed, and secrets remain protected.

```bash
git pull --ff-only origin main

# Frontend inspection should be simple and redacted.
cd /opt/habersoft-rss/rss-admin-ui
docker compose -f deploy/production/compose.yaml ps
docker compose -f deploy/production/compose.yaml --env-file .env.production ps
docker compose -f deploy/production/compose.yaml --env-file .env.production logs --tail=120 rss-admin-ui
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
npm run production:diagnose:redacted

# Recreate if operator chooses; Codex must not execute this.
docker compose --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  up -d --force-recreate rss-admin-ui

curl -fsS http://127.0.0.1:8081/healthz
curl -i https://rss-panel.habersoft.com/status-api/health/ready
curl -i https://rss-panel.habersoft.com/admin-auth/session

ADMIN_AUTH_SMOKE_USERNAME="<redacted>" \
ADMIN_AUTH_SMOKE_PASSWORD="<redacted>" \
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com

npm run verify:operator-ergonomics
```

If the frontend container may be down/restarting, first check Compose ps/logs, entrypoint diagnostics, upstream origin contract, and `/healthz`. If `/admin-auth/session` returns `501 not_configured`, backend admin-auth env likely is not loaded in the backend API runtime. If proxy routes return `502` with `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`, fix the frontend server-only upstream contract. Do not use 127.0.0.1 inside Docker bridge; use backend service alias through `compose.backend-network.yaml` or proven host-gateway reachability.

## MS-024C production overlay canonicalization retest

Bounded status: `MS-024C_PRODUCTION_OVERLAY_CANONICALIZATION_READY_OPERATOR_RETEST_REQUIRED`.

Operator evidence intake for MS-024C:

- `npm run production:diagnose:redacted`, `npm run ops:compose:ps`, and `npm run ops:compose:logs` improved operator ergonomics;
- plain `deploy/production/compose.yaml` recreate with `main-service-api` service DNS failed with `host not found in upstream "main-service-api"` and hid `/healthz` behind a restart-loop;
- adding `deploy/production/compose.backend-network.yaml` made the frontend container healthy and restored `/healthz` plus status routes;
- historical MS-024C `/admin-auth/session` remained `501 not_configured`, classified as `AUTH_NOT_CONFIGURED_RESIDUAL`; MS-024E records the later operator retest as `AUTH_CONFIGURED_UNAUTHENTICATED`.

Production retest sequence:

```bash
git pull --ff-only origin main
cd /opt/habersoft-rss/rss-admin-ui

npm run production:diagnose:redacted
npm run ops:compose:config
npm run ops:compose:recreate
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui

curl -fsS http://127.0.0.1:8081/healthz
curl -i https://rss-panel.habersoft.com/status-api/health/live
curl -i https://rss-panel.habersoft.com/status-api/health/ready
curl -i https://rss-panel.habersoft.com/admin-auth/session

ADMIN_AUTH_SMOKE_USERNAME="<operator-owned>" \
ADMIN_AUTH_SMOKE_PASSWORD="<operator-owned>" \
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

If the helper reports `backend_network_required_for_service_dns`, set `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>` in the operator-owned frontend env and rerun `npm run ops:compose:config`. Do not use `127.0.0.1`, `localhost`, `::1`, `[::1]`, `0.0.0.0`, `https://rss.habersoft.com`, or `https://rss-panel.habersoft.com` as production Docker bridge upstream origins. Host-gateway mode is a fallback only after container-side reachability proof.

If the status routes pass but `/admin-auth/session` remains `501 not_configured`, the residual classes are backend admin-auth mode disabled/missing, backend admin username missing/placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured. Run the backend verifiers from `rss-habersoft-com`:

```bash
npm run production:admin-auth:diagnose:redacted -- --synthetic
npm run production:admin-auth:compose:verify
npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled
```

Backend production Compose now maps admin-auth values into `main-service-api` and intentionally omits them from `main-service-worker`. After backend auth env activation or any backend API/image/network/admin-auth env recreate, recreate `main-service-api` under the backend runbook, then always recreate the frontend with `npm run ops:compose:recreate` before rerunning `auth-smoke:redacted`. Authenticated admin shell remains pending until redacted login/session/logout smoke passes.

Advanced direct Compose fallback for operators who intentionally bypass the helper:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  up -d --no-build --pull never --force-recreate rss-admin-ui
```

The helper path is preferred because it prints a redacted Compose-file summary and blocks before a known bad service-DNS recreate.

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

MS-023D accepts only the read-only status-dashboard production transport. MS-024E records that `AUTH_NOT_CONFIGURED_RESIDUAL` is resolved to `AUTH_CONFIGURED_UNAUTHENTICATED` by operator report, but authenticated admin-shell production acceptance remains pending until redacted login/session/logout evidence is accepted.
