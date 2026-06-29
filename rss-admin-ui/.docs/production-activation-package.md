# Production Activation Package

Status: `MS-023C_STATUS_API_PRODUCTION_NETWORK_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

MS-023C prepares a no-secret, no-deploy, operator-managed production package for the admin UI and remediates the operator-reported status-api production networking blocker. It validates the local production-mode release candidate, package templates, upstream contract, backend-network overlay, and networking harness with synthetic/local fixtures only. It does not contact production, does not mutate production, does not capture rollback baseline, performs no production deployment, does no registry publication, creates no Git tag, creates no GitHub Release, and creates no PR.

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

Backend admin auth variables are documented in `../rss-habersoft-com/.docs/admin-auth-production-activation.md` from the repository root. They include `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, `ADMIN_UI_SESSION_COOKIE_SECURE`, and related session controls.

Both upstream origins must be internal backend origins reachable from inside the admin UI proxy runtime. They must not be public Habersoft edge origins such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package they must also not use container-local or unspecified hosts such as `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`.

The secretless operator template is `deploy/production/operator-managed.env.template`. It includes both frontend runtime placeholders and backend admin-auth placeholders so operators can assemble untracked runtime env files without copying values into Git. Preferred backend-network mode uses `deploy/production/compose.backend-network.yaml`, `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`, and service DNS such as `http://main-service-api:3000`. Host-gateway mode with `http://host.docker.internal:3200` is allowed only after an operator-run container-side reachability check proves that the backend port is reachable through host-gateway.

## Current Status-API Blocker

Bounded status: `OPERATOR_DEPLOYED_HEALTHZ_VERIFIED_STATUS_API_BLOCKED`.

Operator-reported symptom: public `https://rss-panel.habersoft.com/status-api/health/ready` fails while `/healthz` works.

Cause: MS-023B corrected the public-edge anti-pattern, but the operator then reported `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200` still produced public status-api `502`. In the admin UI production Docker bridge container, this is a container-loopback upstream misconfiguration.

Fix: prefer backend-network mode with `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>` and `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://<backend_service_or_alias>:3000`; use host-gateway only after container-side reachability proof. Do not use 127.0.0.1 in the admin UI production Docker bridge package. See [.docs/status-api-upstream-remediation.md](status-api-upstream-remediation.md).

## Local RC Acceptance

Run from `rss-admin-ui`:

```bash
npm run test:production-mode-rc
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
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
- login/session/logout smoke;
- `/status-api/health/live` and `/status-api/health/ready` through the panel path;
- protected shell locked, unlocked, and locked-after-logout behavior;
- no Agent/Tenant credential exposure;
- rollback image/env identity;
- no raw logs, raw secrets, raw production response bodies, or production credential collection in Git.

## Operator-Managed Deployment Boundary

Before any server mutation, the operator must capture rollback baseline and current-state evidence according to the backend/frontend runbooks. MS-023A-R2 does not capture or infer that baseline.

The operator later applies the package by selecting a Git SHA/image identity, placing real backend admin-auth values in the backend runtime env, placing frontend runtime values in the admin UI runtime env, selecting backend-network service DNS or proven host-gateway for the admin UI proxy, keeping the admin UI bound to loopback, and configuring the external edge separately. These instructions are human/operator-managed and are not executed by Codex in MS-023C.

Admin UI full production acceptance remains pending until the operator-managed production networking fix is applied and live `/status-api/health/ready` is verified with redacted evidence.
