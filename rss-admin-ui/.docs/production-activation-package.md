# Production Activation Package

Status: `MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR`.

MS-024A preserves MS-023D read-only production status-dashboard transport acceptance for the already operator-managed live admin UI surface and prepares the remaining authenticated-admin activation package. It preserves the no-secret, operator-managed production package, validates local production-mode release candidates with synthetic/local fixtures only, adds proxy CORS-header hardening, improves backend admin-auth env-file validation, and adds redacted auth smoke tooling. It does not mutate production, capture rollback baseline, perform production deployment, publish a registry image, create a Git tag, create a GitHub Release, or create a PR.

Rollback baseline is operator-managed. Server deployment/configuration is operator-managed. Codex-owned repository work is limited to templates, same-origin proxy configuration, local validation, and runbook guidance.

## Same-Origin Production Model

The browser uses only relative same-origin paths:

| Browser path | Frontend runtime behavior | Backend path |
|---|---|---|
| `GET /status-api/health/live` | Exact health proxy, no credentials | `GET /health/live` |
| `GET /status-api/health/ready` | Exact health proxy, no credentials | `GET /health/ready` |
| `GET /admin-auth/session` | Exact auth proxy or static fail-closed sentinel | `GET /admin-auth/session` |
| `POST /admin-auth/login` | Exact auth proxy or static fail-closed sentinel | `POST /admin-auth/login` |
| `POST /admin-auth/logout` | Exact auth proxy or static fail-closed sentinel | `POST /admin-auth/logout` |

Unknown `/status-api/**` and `/admin-auth/**` paths reject safely. Unsupported methods reject safely. No generic `/api` proxy is introduced. The frontend runtime owns upstream origins; browser config exposes only the non-secret environment label.

## Frontend Runtime Variables

| Variable | Consumed by | Required | Secret? | Notes |
|---|---|---:|---:|---|
| `RSS_ADMIN_UI_IMAGE` | Docker Compose | production yes | no | Must be immutable in a future deployment milestone. |
| `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` | container entrypoint | yes | no | Server-only HTTP(S) origin, no path/query/userinfo/fragment. |
| `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` | container entrypoint | optional | no | When absent, `/admin-auth/**` stays fail-closed. When present, exact auth routes proxy upstream. |
| `ADMIN_UI_ENVIRONMENT_NAME` | generated `env-config.js` | yes | no | Browser-visible label only. |
| `ADMIN_UI_HOST_PORT` | Docker Compose | yes | no | Loopback host port for future edge handoff. |

Backend admin auth variables are documented in `../rss-habersoft-com/.docs/admin-auth-production-activation.md` from the repository root and mirrored as a frontend handoff checklist in `deploy/production/backend-admin-auth.env.template`. They include `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, `ADMIN_UI_SESSION_COOKIE_SECURE`, and related session controls. They must be applied to the backend API runtime; passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth.

Both upstream origins must be internal backend origins reachable from inside the admin UI proxy runtime. They must not be public Habersoft edge origins such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package they must also not use container-local or unspecified hosts such as `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`. MS-024A does not broaden CORS; the status and auth proxy routes hide upstream `Access-Control-*` response headers from the browser.

The secretless frontend operator template is `deploy/production/operator-managed.env.template`. The backend-only auth checklist is `deploy/production/backend-admin-auth.env.template`. Keep filled copies operator-owned and untracked. Preferred backend-network mode uses `deploy/production/compose.backend-network.yaml`, `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`, and service DNS such as `http://main-service-api:3000`. Host-gateway mode with `http://host.docker.internal:3200` is allowed only after an operator-run container-side reachability check proves that the backend port is reachable through host-gateway.

## MS-023D Live Acceptance

Bounded status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`.

Operator-reported and Codex public read-only verified result:

- `/healthz` returns `200 ok`;
- `/status-api/health/live` returns `200` with `status=live`;
- `/status-api/health/ready` returns `200` with `status=ready`, `postgres=up`, `redis=up`, and `tenantAuth=up`;
- `/admin-auth/session` returns HTTP `501` with `status=not_configured`.

The `501 not_configured` admin-auth result is `AUTH_NOT_CONFIGURED_RESIDUAL`. It is not a blocker for read-only status-dashboard closure; it is a blocker for authenticated admin-shell production acceptance. Do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` for this residual. Verify backend runtime admin-auth env placement, verify `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` remains an internal backend origin, and restart/recreate the backend API under the operator rollback plan after correcting backend env placement. See [live-status-dashboard-acceptance.md](live-status-dashboard-acceptance.md) and [status-api-upstream-remediation.md](status-api-upstream-remediation.md).

MS-023D status-dashboard production transport remains accepted. In MS-024A, `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient because backend admin-auth variables must be present in the backend API service runtime. The operator should validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled`, apply it to the backend runtime outside Git, and then perform backend API restart/recreate under the operator rollback plan.

## MS-024A Redacted Auth Smoke

The repository provides `npm run auth-smoke:redacted` for operator-managed evidence collection:

```bash
ADMIN_AUTH_SMOKE_BASE_URL=https://rss-panel.habersoft.com npm run auth-smoke:redacted
ADMIN_AUTH_SMOKE_BASE_URL=https://rss-panel.habersoft.com ADMIN_AUTH_SMOKE_USERNAME=<operator-owned-username> ADMIN_AUTH_SMOKE_PASSWORD=<operator-owned-password> npm run auth-smoke:redacted -- --login-smoke
```

Do not paste real admin credentials, cookies, password hashes, session secrets, Redis keys, raw logs, or raw response bodies into Git/chat/docs. The default mode performs only `GET /admin-auth/session` classification. Optional login smoke uses environment variables only, stores the temporary cookie jar under `ADMIN_AUTH_SMOKE_TMP_DIR` when provided, deletes that jar, and emits redacted summaries suitable for a later operator evidence receipt.

## Local RC Acceptance

Run from `rss-admin-ui`:

```bash
npm run test:production-mode-rc
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run test:admin-auth-smoke-redacted
npm run test:status-api-production-networking
npm run test:status-api-upstream-remediation
```

The RC harness builds local backend/frontend images, starts PostgreSQL, Redis, the backend API, the local JWKS fixture, and the frontend container in isolated Docker Compose projects. It proves:

- disabled admin auth fails closed by default;
- synthetic `single_admin` auth starts only when all required values are present;
- wrong login is rejected;
- correct synthetic login sets only the approved server-controlled HttpOnly cookie;
- session after login returns safe authenticated state;
- logout invalidates the server-side session;
- live/ready health still traverse only exact same-origin health routes;
- public-edge-style upstream `403` is converted to a bounded browser-safe failure with no raw diagnostic body;
- Docker bridge loopback/container-local upstreams fail closed at container startup;
- unreachable upstream connection failures return bounded browser-safe JSON `502` with no raw Nginx diagnostic body;
- internal upstream live/ready remediation succeeds with synthetic local fixtures;
- live-evidence intake docs classify `AUTH_NOT_CONFIGURED_RESIDUAL` without claiming authenticated admin acceptance;
- frontend runtime and backend admin-auth env templates remain separated;
- unknown auth/status paths and wrong methods reject safely;
- browser static assets and runtime config do not contain upstream origins, password, password hash, session secret, Agent key, Tenant bearer token, or browser auth persistence calls;
- harness containers, networks, and volumes are removed after validation.

This local RC does not prove production activation. It is a release-candidate acceptance package for a later operator-authorized, operator-managed deployment.

## Browser Safety Boundary

The admin UI must not use `localStorage`, `sessionStorage`, `IndexedDB`, `cookieStore`, or `document.cookie` for auth persistence. The browser must not receive an Agent `X-Agent-Key`, Tenant bearer token, JWT signing material, backend upstream origin, generated password hash, session secret, Redis key, or production credential. The health dashboard remains read-only and credential-free; protected shell visibility depends only on the same-origin session status.

## Future Evidence Checklist

A later production activation receipt must include redacted evidence for:

- immutable image identity;
- remote Git SHA;
- environment variable presence, with secret values redacted;
- fail-closed session before login;
- `AUTH_NOT_CONFIGURED_RESIDUAL` if `/admin-auth/session` is still `501 not_configured`;
- login/session/logout smoke;
- `/status-api/health/live` and `/status-api/health/ready` through the panel path;
- protected shell locked, unlocked, and locked-after-logout behavior;
- no Agent/Tenant credential exposure;
- rollback image/env identity;
- no raw logs, raw secrets, raw production response bodies, or production credential collection in Git.

## Operator-Managed Deployment Boundary

Before any server mutation, the operator must capture rollback baseline and current-state evidence according to the backend/frontend runbooks. MS-023A-R2 does not capture or infer that baseline.

The operator later applies the authenticated-admin package by selecting a Git SHA/image identity, placing real backend admin-auth values in the backend runtime env, placing frontend runtime values in the admin UI runtime env, selecting backend-network service DNS or proven host-gateway for the admin UI proxy, keeping the admin UI bound to loopback, and configuring the external edge separately. These instructions are human/operator-managed and are not executed by Codex in MS-023D.

Read-only status-dashboard production transport is accepted in MS-023D. Authenticated admin-shell production acceptance remains pending until backend admin auth is configured in the backend runtime and redacted login/session/logout evidence is accepted.
