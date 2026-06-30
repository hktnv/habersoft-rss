# rss-admin-ui

`rss-admin-ui` is the React/Vite admin UI project for the Habersoft RSS repository.

Status: `MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`.

## Scope

Included through MS-025A:

- application shell,
- root route,
- runtime environment-label adapter,
- error boundary,
- accessibility-oriented semantic shell,
- read-only status dashboard,
- public health client for `/status-api/health/live` and `/status-api/health/ready`,
- exact-route same-origin health proxy in the frontend Nginx runtime,
- runtime validation for liveness/readiness payloads and dependency states,
- manual refresh with stale-result suppression,
- unit tests,
- production build,
- static Docker runtime,
- production deployment template,
- production activation readiness contract,
- local production readiness verifier,
- fail-closed protected admin/business shell foundation,
- same-origin admin session routes at `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`,
- static fail-closed auth sentinel when `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent,
- exact-route auth proxy when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured,
- protected login/session/logout UI,
- frontend auth/session boundary verifier,
- auth-session sentinel runtime harness,
- auth proxy runtime harness,
- auth proxy upstream CORS response-header stripping,
- redacted admin auth smoke tool and local harness,
- classified redacted admin auth smoke diagnostics,
- operator Compose ps/logs/diagnose helpers,
- graduated guardrails for unsafe upstream origins,
- route-level degraded JSON responses for invalid upstream configuration,
- local full-stack auth acceptance harness,
- secretless admin auth production activation package,
- local production-mode RC acceptance harness,
- production activation package verifier,
- operator-managed production package verifier,
- production upstream contract verifier,
- status-api upstream remediation harness,
- status-api production networking harness,
- secretless operator env template,
- backend-network production Compose overlay,
- operator handoff docs for a future no-secret production activation milestone,
- live read-only production status-dashboard evidence intake,
- backend admin-auth env placement template,
- `AUTH_NOT_CONFIGURED_RESIDUAL` remediation verifier,
- MS-024A auth enablement package verifier.
- MS-024B operator ergonomics verifier,
- MS-024C production overlay canonicalization verifier,
- MS-024D backend admin-auth runtime env wiring guidance,
- MS-024E configured unauthenticated evidence intake and post-backend-recreate frontend helper guardrail,
- MS-024F operator-reported authenticated admin shell production acceptance closeout,
- authenticated read-only Operations Overview,
- same-origin `GET /admin-api/operations/summary` client,
- exact-route admin-api proxy harness,
- generated Nginx admin-api proxy template harness,
- local full-stack synthetic admin operations acceptance,
- MS-025A admin operations dashboard verifier.

Not included:

- write-capable business pages,
- production credential provisioning,
- Codex-run production login/session activation,
- Codex-run credentialed production smoke,
- Agent authentication,
- backend writes,
- automatic polling or monitoring history,
- raw feed URLs, tenant identifiers, entry content, raw logs, or raw upstream bodies,
- production evidence projection,
- production deployment,
- MS-025A live production acceptance before operator deploy/retest.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:auth-session-sentinel
npm run test:auth-proxy
npm run test:admin-api-proxy-template
npm run test:admin-operations-proxy
npm run test:admin-auth-smoke-redacted
npm run test:proxy-security
npm run test:status-api-upstream-remediation
npm run test:status-api-production-networking
npm run test:fullstack
npm run test:production-mode-rc
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:production-auth-acceptance
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run verify:operator-ergonomics
npm run verify:production-overlay-canonicalization
npm run verify:admin-operations-dashboard
npm run ops:compose:config
npm run ops:compose:up -- --force-recreate rss-admin-ui
npm run ops:compose:recreate
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
npm run production:diagnose:redacted
npm run verify:auth-boundary
npm audit --omit=dev
```

## Runtime Config

Docker runtime config is supplied through:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only and must be an absolute HTTP(S) internal backend origin without userinfo, path, query, or fragment. It must be reachable from inside the admin UI proxy runtime and must not be a public edge hostname such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package it must also not use `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`; those names refer to the admin UI container or an unspecified local address, not the backend host loopback. No secret belongs in the frontend bundle or runtime config. The dashboard does not render the upstream origin; it shows only the non-secret environment label and current browser-observed health state.

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is also server-only and optional. When absent, `/admin-auth/**` stays in static fail-closed mode. When present, only `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` are proxied upstream. When enabled in production it must use the same internal backend origin class as health, not the public backend edge.

MS-025A reuses `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` for the exact read-only admin-api route `GET /admin-api/operations/summary`. The frontend runtime does not add a third upstream variable. The route is GET-only, strips query forwarding, forwards only the browser's same-origin admin session cookie, hides upstream `Set-Cookie`, `WWW-Authenticate`, and CORS response headers, and returns bounded JSON for unauthenticated, unavailable, wrong-method, or unknown-path cases.

MS-025A-R1 adds a generated-template regression harness for the operator-reported production blocker where the running frontend image lacked the admin-api marker in the active Nginx template and `/admin-api/operations/summary` fell through to `index.html`. The active generated config is `/tmp/nginx/conf.d/default.conf`; `/etc/nginx/conf.d/default.conf` may be stock or irrelevant. `npm run test:admin-api-proxy-template` proves the effective config contains `location = /admin-api/operations/summary`, contains JSON fallback routes for `/admin-api` and `/admin-api/*`, contains no unresolved `__ADMIN_UI_*__` markers, and returns JSON rather than SPA HTML for tested `/admin-api/*` requests.

MS-024B changes the operator runtime posture to graduated guardrails. Missing, malformed, public-edge, or Docker bridge loopback upstreams no longer crash-loop the static frontend container. `/healthz` and the static app start, while exact proxy routes return bounded JSON with reasons such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. Unsafe upstream traffic still does not proxy successfully. `ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION=true` remains available for strict synthetic checks.

MS-024C adds the production overlay canonicalization layer. In production Docker bridge mode, backend service DNS such as `main-service-api` resolves only when the admin UI container is attached to the backend Docker network. For that topology, `compose.backend-network.yaml` is part of the canonical runtime invocation, not an optional remembered overlay. Use `npm run ops:compose:config` and `npm run ops:compose:recreate`; the helper includes the overlay when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured and blocks before recreate with redacted guidance if a service-DNS upstream is configured without that network input. Plain `deploy/production/compose.yaml` remains useful for static inspection and degraded/no-upstream defaults, but it is not the complete production runtime path for `http://main-service-api:3000`.

Backend admin-auth variables such as `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE` are consumed by the backend API runtime, not by the frontend/admin UI runtime. Passing those backend-only variables only to the frontend/admin UI Compose command does not enable backend auth.

MS-024D lands the backend production Compose mapping for those variables into `main-service-api` and verifies that `main-service-worker` does not receive them. MS-024E records operator-reported retest evidence that backend admin-auth is configured and `/admin-auth/session` returns `configured=true`, `authenticated=false`, `reason=unauthenticated` after the frontend is recreated with the canonical overlay helper. After any backend API/image/network/admin-auth env recreate, run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` before collecting edge auth evidence. MS-024F records operator-reported authenticated admin shell production acceptance after the MS-024E retest residual. `auth-smoke:redacted` remains a redacted regression/sanity tool, not a pending acceptance blocker for the current implemented auth shell scope.

MS-025A adds a locally accepted, production-pending Operations Overview that is visible only after `/admin-auth/session` returns `authenticated=true`. It performs one initial load plus manual refresh only. It never polls, persists history, stores browser credentials, uses Tenant bearer tokens, uses Agent keys, renders raw logs or rows, or exposes write controls. If the admin-api route is unavailable after backend or network changes, the UI directs the operator to recreate the frontend with the canonical helper before retesting.

## Health Dashboard

The dashboard performs one initial observation and then requires manual refresh. It reads only:

```text
GET /status-api/health/live
GET /status-api/health/ready
```

The frontend runtime maps those routes to `/health/live` and `/health/ready` on `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Requests use `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, and no auth, cookie, bearer, Tenant, or Agent credential. It stores no browser history in localStorage, sessionStorage, IndexedDB, or cookies.

## Admin Operations Overview

The protected operations overview performs one initial observation and then requires manual refresh. It reads only:

```text
GET /admin-api/operations/summary
```

The backend response is a safe aggregate object with `status`, `generatedAt`, `window.recentHours`, `dependencies.postgres`, `dependencies.redis`, `dependencies.tenantAuth`, `feeds.total`, `feeds.active`, `feeds.disabled`, `feeds.dueNow`, `entries.total`, `entries.createdLast24h`, `ingestion.checksLast24h`, `ingestion.successLast24h`, `ingestion.failedLast24h`, `ingestion.latestCheckAt`, and `notes`.

Unavailable metrics are represented as `null` plus a safe note. The route must not expose tenant identifiers, feed URLs, entry content, raw feed content, raw logs, raw request/response bodies, upstream origins, password hashes, session secrets, cookies, Agent keys, Tenant tokens, or database/Redis URLs.

Production activation of this MS-025A slice is pending operator deploy/retest. After any backend API/image/network/admin-auth env recreate, run:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
```

If Nginx template or entrypoint source changed, first rebuild or update the configured frontend image. A Git pull plus container recreate can still run an old image template. Before UI retest, the operator can verify the running container's effective route config with an operator-side command equivalent to:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F "/admin-api/operations/summary" && ! grep -F "__ADMIN_UI_" /tmp/nginx/conf.d/default.conf'
```

Then retest login, `/admin-auth/session`, `/admin-api/operations/summary`, logout, and the locked-after-logout state without pasting credentials, cookies, raw response bodies, or logs into Git/chat/docs.

## Admin Auth Boundary

MS-022A adds a local/tested admin auth/session foundation. Backend auth defaults to `ADMIN_UI_AUTH_MODE=disabled`, has no default credential, and requires explicit synthetic/local or future production-provisioned values before `single_admin` mode can run. Sessions are server-side and use an opaque HttpOnly `SameSite=Lax` cookie. MS-025A scopes that cookie to `Path=/` so it authenticates both `/admin-auth/*` and `/admin-api/*`; production keeps the `Secure` attribute, and logout clears both `Path=/` and the historical `Path=/admin-auth` cookie. No Agent key, Tenant bearer token, JWT, refresh token, cookie secret, private key, or privileged business data belongs in the browser. Future business admin write features and production activation require separate authority.

MS-022B prepares the activation package without activating production. Backend helpers generate or validate PBKDF2 admin password hashes, generate or validate session secrets, and verify production-like admin auth env without printing secret values. The local RC harness uses only synthetic credentials and actual local Docker runtime components.

MS-023A-R2 keeps production activation out of scope and makes the production package explicitly operator-managed. Rollback baseline is operator-managed, server deployment/configuration is operator-managed, and this repository package is validated locally with synthetic credentials only.

MS-023B keeps production mutation out of scope and remediates the operator-reported public-edge status-api blocker. MS-023C keeps production mutation out of scope and remediates the operator-reported container-loopback upstream misconfiguration. In the production Docker bridge package, do not use `http://127.0.0.1:3200`, `localhost`, `::1`, `[::1]`, or `0.0.0.0` for admin UI upstream origins. Prefer backend-network mode with `compose.backend-network.yaml`, `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`, and `http://<backend_service_or_alias>:3000`. The repository backend production Compose service is `main-service-api` and its container port is `3000`. Use `http://host.docker.internal:3200` only after an operator-run container-side reachability check proves that the backend port is reachable through host-gateway.

MS-023D records operator-reported plus Codex public read-only verification that production `/healthz`, `/status-api/health/live`, and `/status-api/health/ready` are accepted for the read-only status-dashboard transport. At that time `/admin-auth/session` remained HTTP `501 not_configured`, classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. MS-024E records operator-reported evidence that the auth residual became `AUTH_CONFIGURED_UNAUTHENTICATED` after backend env activation and frontend helper recreate. MS-024F closes the current authenticated admin-shell production acceptance residual by operator report only. Codex did not independently perform a credentialed login, did not read real credentials, and did not mutate production.

MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR keeps that live status-dashboard result accepted and prepares the remaining authenticated-admin activation package. MS-023D status-dashboard production transport remains accepted. The same-origin status/auth proxies now hide upstream `Access-Control-*` response headers; authenticated admin activation still requires backend admin-auth values in the backend API service runtime. `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient; use `deploy/production/backend-admin-auth.env.template` for the backend runtime and restart/recreate the backend API under the operator rollback plan after placement. Redacted local/operator smoke support is available through `npm run auth-smoke:redacted`, with real credentials supplied only by environment variables and never by command-line arguments.

MS-024B_OPERATOR_ERGONOMICS_AUTH_SMOKE_REMEDIATION_READY_OPERATOR_RETEST_REQUIRED responds to the operator-reported `admin-auth-smoke: fetch failed`, frontend Compose interpolation failure, and restart-loop blocker. Frontend production Compose uses `habersoft-rss-frontend:latest` only as an operator-managed mutable local image default so `docker compose -f deploy/production/compose.yaml ps` and `config` can inspect without an env file. Release candidates should still use an immutable image identity in operator env. That milestone did not claim live auth acceptance; MS-024F later closes the current auth-shell acceptance residual by operator report.

MS-024C responds to the operator-reported plain-compose recreate failure where Nginx crashed on `host not found in upstream "main-service-api"`. Runtime proxy generation now resolves backend service DNS at request time, so a missing backend-network attachment should not hide `/healthz`, `env-config.js`, or static assets. Exact `/status-api/*` and `/admin-auth/*` routes still fail closed with bounded JSON when upstream DNS or reachability is wrong.

MS-024D responds to the remaining backend-auth residual by wiring backend admin-auth env names into the production backend API service. MS-024E intakes the operator report that the wiring is live and the frontend edge now reaches configured unauthenticated backend auth after `npm run ops:compose:recreate`. MS-024F records the operator's latest production retest statement that authenticated admin shell acceptance is closed for the current implemented scope. Future business/admin write features remain out of scope.

MS-025A locally accepts the first protected read-only admin product slice after that shell acceptance: aggregate operations visibility only, no write controls, and no live production acceptance claim until operator deploy/retest.

## Docker

Local image build:

```bash
docker build -t rss-admin-ui:0.1.0 .
```

Container health endpoint:

```text
/healthz
```

Local root Compose publishes the UI on loopback port `8081`.

Operator inspection helpers:

```bash
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
npm run ops:compose:config
npm run ops:compose:up -- --force-recreate rss-admin-ui
npm run ops:compose:recreate
npm run production:diagnose:redacted
npm run verify:operator-ergonomics
npm run verify:production-overlay-canonicalization
npm run verify:admin-operations-dashboard
```

MS-025A local rehearsal commands:

```bash
docker build -t rss-admin-ui:ms023d-local .
npm run test:auth-session-sentinel
npm run test:auth-proxy
npm run test:admin-api-proxy-template
npm run test:admin-operations-proxy
npm run test:admin-auth-smoke-redacted
npm run test:proxy-security
npm run test:status-api-upstream-remediation
npm run test:status-api-production-networking
npm run test:fullstack
npm run test:production-mode-rc
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run verify:admin-operations-dashboard
npm run verify:auth-boundary
```

## Docs

- [Production guide](PRODUCTION.md)
- [API/auth contract](.docs/api-auth-contract.md)
- [Admin auth/session boundary](.docs/admin-auth-session-boundary.md)
- [Admin operations dashboard](.docs/admin-operations-dashboard.md)
- [Admin session sentinel](.docs/admin-session-sentinel.md)
- [Production activation readiness contract](.docs/production-activation-readiness.md)
- [Production activation package](.docs/production-activation-package.md)
- [Live status dashboard acceptance](.docs/live-status-dashboard-acceptance.md)
- [Status-api upstream remediation](.docs/status-api-upstream-remediation.md)
- [Admin auth production operator handoff](.docs/admin-auth-production-operator-handoff.md)
- [Read-only status dashboard contract](.docs/read-only-status-dashboard.md)
- [Same-origin health transport contract](.docs/same-origin-health-transport.md)
