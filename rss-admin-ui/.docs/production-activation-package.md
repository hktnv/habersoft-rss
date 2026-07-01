# Production Activation Package

Status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

MS-024A preserves MS-023D read-only production status-dashboard transport acceptance for the already operator-managed live admin UI surface and prepares the remaining authenticated-admin activation package. MS-024B adds operator ergonomics, classified auth-smoke diagnostics, and graduated guardrails for the operator-reported latest recreate blocker. MS-024C canonicalizes the backend-network overlay/helper path for production service-DNS upstreams, prevents missing service DNS from hiding `/healthz`, and sharpens backend-auth residual diagnostics. MS-024E records operator-reported evidence that backend admin-auth is configured and the frontend edge returns `AUTH_CONFIGURED_UNAUTHENTICATED` after `npm run ops:compose:recreate`. MS-024F records the operator-reported production retest statement that authenticated admin shell production acceptance is closed for the current implemented status/auth shell scope. MS-025A adds the protected read-only operations dashboard package locally. MS-025A-R1 remediates the operator-reported production proxy-template blocker by requiring generated Nginx config proof for `/tmp/nginx/conf.d/default.conf`, `nginx -T`, the exact admin-api summary route, and JSON fail-closed `/admin-api` fallback routes. MS-025A-R2 closes the read-only operations summary dashboard production acceptance and R1 proxy-template residual by operator report. MS-025B adds the protected read-only Operations Drilldown locally at `GET /admin-api/operations/drilldown`; drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. MS-026A adds bounded feed recheck action support at `POST /admin-api/operations/feed-recheck-requests` and leaves operator deploy/retest required. This package preserves the no-secret, operator-managed production package, validates local production-mode release candidates with synthetic/local fixtures only, keeps proxy CORS-header hardening, improves backend admin-auth env-file validation, and keeps redacted auth smoke tooling as a regression/sanity tool. It does not mutate production, capture rollback baseline, perform production deployment, perform Codex credentialed login, publish a registry image, create a Git tag, create a GitHub Release, or create a PR. No production deployment was performed by Codex for MS-026A.

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
| `GET /admin-api/operations/summary` | Exact admin-api proxy, authenticated read-only aggregate route | `GET /admin-api/operations/summary` |
| `GET /admin-api/operations/drilldown` | Exact admin-api proxy, authenticated read-only bounded drilldown route | `GET /admin-api/operations/drilldown` |
| `POST /admin-api/operations/feed-recheck-requests` | Exact admin-api proxy, authenticated bounded feed recheck action route | `POST /admin-api/operations/feed-recheck-requests` |

Unknown `/status-api/**`, `/admin-auth/**`, and `/admin-api/**` paths reject safely. Unsupported methods reject safely. No generic `/api` proxy is introduced. The frontend runtime owns upstream origins; browser config exposes only the non-secret environment label.

## Frontend Runtime Variables

| Variable | Consumed by | Required | Secret? | Notes |
|---|---|---:|---:|---|
| `RSS_ADMIN_UI_IMAGE` | Docker Compose | production recommended | no | `habersoft-rss-frontend:latest` is an operator-managed mutable local image default for inspection only; release candidates should provide an immutable image identity. |
| `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` | container entrypoint | route-level required | no | Server-only HTTP(S) origin, no path/query/userinfo/fragment. Missing or invalid values degrade exact routes to safe JSON. |
| `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` | container entrypoint | optional | no | When absent, `/admin-auth/**` stays fail-closed. When present, exact auth routes proxy upstream. |
| `ADMIN_UI_ENVIRONMENT_NAME` | generated `env-config.js` | defaulted | no | Browser-visible label only. |
| `ADMIN_UI_HOST_PORT` | Docker Compose | defaulted | no | Loopback host port for future edge handoff. |

Backend admin auth variables are documented in `../rss-habersoft-com/.docs/admin-auth-production-activation.md` from the repository root and mirrored as a frontend handoff checklist in `deploy/production/backend-admin-auth.env.template`. They include `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, `ADMIN_UI_SESSION_COOKIE_SECURE`, and related session controls. They must be applied to the backend API runtime; passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth. MS-025A and MS-025B use the same backend auth session for `/admin-api/operations/summary` and `/admin-api/operations/drilldown`; the session cookie is scoped to `Path=/`, and logout clears both the root path and the historical `/admin-auth` path.

Both upstream origins must be internal backend origins reachable from inside the admin UI proxy runtime. They must not be public Habersoft edge origins such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package they must also not use container-local or unspecified hosts such as `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`. MS-024B uses graduated guardrails: the static frontend and `/healthz` start, while exact proxy routes return `502` with `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. Unsafe upstream traffic still does not proxy successfully. MS-024A/MS-024B do not broaden CORS; the status and auth proxy routes hide upstream `Access-Control-*` response headers from the browser.

The secretless frontend operator template is `deploy/production/operator-managed.env.template`. The backend-only auth checklist is `deploy/production/backend-admin-auth.env.template`. Keep filled copies operator-owned and untracked. Preferred backend-network mode uses `deploy/production/compose.backend-network.yaml`, `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>`, and service DNS such as `http://main-service-api:3000`. For production Docker bridge service DNS, that overlay is canonical runtime input. Plain `deploy/production/compose.yaml` is inspection/degraded-only for that topology. Host-gateway mode with `http://host.docker.internal:3200` is allowed only after an operator-run container-side reachability check proves that the backend port is reachable through host-gateway.

## MS-023D Live Acceptance And MS-024E Auth Evidence

Bounded status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`.

Operator-reported and Codex public read-only verified result:

- `/healthz` returns `200 ok`;
- `/status-api/health/live` returns `200` with `status=live`;
- `/status-api/health/ready` returns `200` with `status=ready`, `postgres=up`, `redis=up`, and `tenantAuth=up`;
- `/admin-auth/session` returns HTTP `501` with `status=not_configured`.

The historical `501 not_configured` admin-auth result is `AUTH_NOT_CONFIGURED_RESIDUAL`. It was not a blocker for read-only status-dashboard closure; it was the authenticated admin-shell production acceptance residual later resolved by MS-024E configured-auth evidence and MS-024F operator-reported authenticated-shell acceptance. Do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` for this residual. Verify backend runtime admin-auth env placement, verify `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` remains an internal backend origin, and restart/recreate the backend API under the operator rollback plan after correcting backend env placement. See [live-status-dashboard-acceptance.md](live-status-dashboard-acceptance.md) and [status-api-upstream-remediation.md](status-api-upstream-remediation.md).

MS-023D status-dashboard production transport remains accepted. In MS-024A, `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient because backend admin-auth variables must be present in the backend API service runtime. The operator should validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled`, apply it to the backend runtime outside Git, and then perform backend API restart/recreate under the operator rollback plan.

MS-024E intakes the later operator-reported retest:

- backend diagnostics passed with `ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT`, API env wired, and worker `worker_absent_by_design`;
- backend loopback `/admin-auth/session` returned `configured=true`, `authenticated=false`, `reason=unauthenticated`;
- initial frontend edge status/auth failed with `502`/`auth_unavailable` until the frontend was recreated;
- frontend proxy recovered after canonical overlay helper recreate: `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` refreshed backend-network overlay/upstream references;
- post-fix `/admin-auth/session` returned `configured=true`, `authenticated=false`, `reason=unauthenticated`;
- `auth-smoke:redacted` returned `AUTH_CONFIGURED_UNAUTHENTICATED` with empty `diagnostic_classes`.

`AUTH_CONFIGURED_UNAUTHENTICATED` was the MS-024E login_smoke_pending state. MS-024F closes that current-scope residual by operator report only; Codex did not independently perform a credentialed login, did not read or store real credentials, and did not mutate production.

MS-024F authenticated admin shell acceptance:

- bounded status: `MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`;
- browser status label: `AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- accepted scope: status dashboard plus same-origin admin auth shell as currently implemented;
- future business/admin write features are not accepted;
- `auth-smoke:redacted` remains a redacted regression/sanity tool, not a pending acceptance blocker;
- No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.

MS-025A operations dashboard package:

- bounded status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`;
- route: `GET /admin-api/operations/summary`;
- source type: operator_reported live retest evidence; local synthetic validation remains regression proof;
- accepted locally: protected shell operations overview, aggregate dependency/feed/entry/ingestion metrics, exact same-origin admin-api proxy route, root-path admin session cookie, and no browser credential persistence;
- excluded: raw feed URLs, entry content, tenant identifiers, raw logs, raw upstream bodies, upstream origins, cookies, password hashes, session secrets, Agent keys, Tenant tokens, and write controls;
- historical production boundary: operator deploy/retest was required before any live production acceptance statement for the operations dashboard; MS-025A-R2 closes that summary residual by operator report, and MS-025B-R1 closes the drilldown residual by operator report.

MS-025A-R1 admin-api proxy template remediation:

- bounded status: `MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`;
- local proof: `npm run test:admin-api-proxy-template` builds/runs the frontend image, inspects `/tmp/nginx/conf.d/default.conf`, captures `nginx -T`, and asserts that `location = /admin-api/operations/summary` appears before the SPA fallback;
- fail-closed proof: exact `/admin-api`, unknown `/admin-api/*`, unauthenticated summary, unreachable upstream, and static no-auth-upstream cases return JSON rather than SPA HTML;
- startup guardrail: unresolved `__ADMIN_UI_*__` markers or a missing admin-api route fail container startup before Nginx serves traffic;
- historical production boundary: operator image rebuild/update plus frontend recreate and live retest were required before any production acceptance statement for the operations dashboard; MS-025A-R2 closes that residual by operator report.

MS-025A-R2 operations dashboard production acceptance:

- bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- operator-reported evidence: `GET /healthz -> 200 OK`, `GET /status-api/health/live -> JSON 200`, `GET /status-api/health/ready -> JSON 200`, unauthenticated `GET /admin-api/operations/summary -> JSON 401`, unknown `GET /admin-api/foo -> JSON 404`, after browser sign-in, the Operations Overview screen displayed successfully, after browser sign-in, JSON aggregate summary data loaded successfully, `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`, and logout returned the UI to locked / unauthenticated state;
- accepted scope: read-only operations dashboard production acceptance is closed, admin-api production proxy/template remediation is accepted, status dashboard production scope remains accepted, and authenticated admin shell production scope remains accepted;
- auth-smoke boundary: `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails; credentials must be environment variables only and must not be logged;
- residual: No current MS-025A/R1 operator retest residual remains;
- artifact boundary: durable operator-state receipt outside Git records the closeout; temporary workplace paths are not durable operator artifacts;
- future boundary: future business/admin write features are not accepted, and write/business features remain separate bounded milestones.

## MS-026A Bounded Feed Recheck Action

- status: `MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`;
- exact route: `POST /admin-api/operations/feed-recheck-requests`;
- required browser behavior: explicit confirmation, `credentials: "same-origin"`, JSON only, `X-Admin-CSRF`, `X-Admin-Idempotency-Key`, no browser persistence;
- backend behavior: validates an opaque `actionRef`, active eligible feed, subscriber count, and public `sourceHost`, then requests the existing due-feed path;
- safety boundary: no synchronous external feed fetch, no raw feed URL path/query, no entry mutation, no feed CRUD, no tenant management, no Agent key, no Tenant bearer token, no arbitrary admin writes;
- proxy boundary: exact POST allowlist, 2k body limit, query stripped, only required action headers forwarded, upstream `Set-Cookie`, `WWW-Authenticate`, and CORS headers hidden;
- validation: `npm run verify:admin-feed-recheck-action`, `npm run test:admin-api-proxy-template`, `npm run test:fullstack`, and `npm run test:production-mode-rc`;
- residual: operator deploy/retest required. Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets.

MS-025B operations drilldown package:

- bounded status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- route: `GET /admin-api/operations/drilldown`;
- source type: operator_reported live retest evidence; local synthetic validation remains regression proof;
- accepted locally: protected Operations Drilldown panel, strict runtime validation, exact same-origin admin-api proxy route, generated active Nginx config proof, and no browser credential persistence;
- safe fields: opaque `displayId`, safe `displayName`, public `sourceHost`, feed health/status, ingestion status, timestamps, counts, safe notes, `capabilities`, `recentHours=24`, and `maxRows=20`;
- excluded: raw feed URL paths or queries, entry content, entry URLs, tenant identifiers, raw logs, raw upstream bodies, private hostnames, cookies, password hashes, session secrets, Agent key values, Tenant bearer tokens, JWT claims, `localStorage`, `sessionStorage`, `IndexedDB`, `cookieStore`, `document.cookie`, and write controls;
- production boundary: MS-025A-R2 remains accepted for the existing operations summary dashboard; drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence; No production deployment was performed by Codex for MS-025B-R1.

MS-025B operator deploy/retest reminder:

- pull main with `git pull --ff-only origin main`;
- rebuild/update backend and frontend images as required by current runbooks;
- recreate backend API if the backend API runtime changed;
- rebuild/update the configured frontend image if Nginx template or entrypoint source changed;
- run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`;
- test `/healthz`, `/status-api/health/live`, `/status-api/health/ready`, unauthenticated `/admin-api/operations/drilldown` returning JSON `401`, authenticated Operations Drilldown JSON/UI data, and logout returning to locked state.

`auth-smoke:redacted` without credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an observation/sanity state, not a blocker by itself. Do not paste credentials, cookies, raw response bodies, logs, or secrets into Git, docs, chat, or receipts.

## MS-024A Redacted Auth Smoke

The repository provides `npm run auth-smoke:redacted` for operator-managed evidence collection:

```bash
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
ADMIN_AUTH_SMOKE_USERNAME=<operator-owned-username> ADMIN_AUTH_SMOKE_PASSWORD=<operator-owned-password> npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Do not paste real admin credentials, cookies, password hashes, session secrets, Redis keys, raw logs, or raw response bodies into Git/chat/docs. The default mode performs session/status classification. Supplying both `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` through environment variables enables login/session/logout smoke, stores the temporary cookie jar under `ADMIN_AUTH_SMOKE_TMP_DIR` when provided, deletes that jar, and emits redacted next steps. MS-024E auth-smoke status classes are `AUTH_NOT_CONFIGURED_RESIDUAL`, `AUTH_CONFIGURED_UNAUTHENTICATED`, `AUTH_LOGIN_ATTEMPT_FAILED`, `AUTHENTICATED_ADMIN_ACCEPTED`, and `STATUS_API_ROUTE_UNAVAILABLE`. CLI credential arguments are rejected. For MS-025A-R2, `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails.

## Local RC Acceptance

Run from `rss-admin-ui`:

```bash
npm run test:production-mode-rc
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:production-auth-acceptance
npm run verify:operator-ergonomics
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run verify:admin-operations-dashboard
npm run verify:admin-operations-drilldown
npm run verify:production-operations-acceptance
npm run test:admin-auth-smoke-redacted
npm run test:admin-operations-proxy
npm run test:admin-api-proxy-template
npm run verify:production-overlay-canonicalization
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
- Docker bridge loopback/container-local upstreams start the static runtime and fail closed at the exact proxy route boundary;
- unreachable upstream connection failures return bounded browser-safe JSON `502` with no raw Nginx diagnostic body;
- internal upstream live/ready remediation succeeds with synthetic local fixtures;
- live-evidence intake docs preserve historical `AUTH_NOT_CONFIGURED_RESIDUAL`, classify MS-024E `AUTH_CONFIGURED_UNAUTHENTICATED`, and record MS-024F authenticated shell acceptance as operator-reported;
- frontend runtime and backend admin-auth env templates remain separated;
- unknown auth/status paths and wrong methods reject safely;
- generated admin-api proxy template config contains the exact summary route, contains no unresolved admin UI markers, and rejects admin-api fallthroughs as JSON instead of SPA HTML;
- generated admin-api proxy template config contains the exact drilldown route before SPA fallback and rejects drilldown fallthroughs as JSON instead of SPA HTML;
- browser static assets and runtime config do not contain upstream origins, password, password hash, session secret, Agent key, Tenant bearer token, or browser auth persistence calls;
- harness containers, networks, and volumes are removed after validation.

This local RC does not prove production activation. It is a release-candidate acceptance package for a later operator-authorized, operator-managed deployment.

## MS-024C Production Overlay Retest

MS-024C operator retest checklist lives in `../PRODUCTION.md`. The short flow is:

```bash
git pull --ff-only origin main
cd /opt/habersoft-rss/rss-admin-ui
npm run production:diagnose:redacted
npm run ops:compose:config
# Rebuild or update the configured frontend image before recreate when nginx.conf or docker-entrypoint.sh changed.
npm run ops:compose:recreate
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
docker compose exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F "/admin-api/operations/summary" && ! grep -F "__ADMIN_UI_" /tmp/nginx/conf.d/default.conf'
curl -fsS http://127.0.0.1:8081/healthz
curl -i https://rss-panel.habersoft.com/status-api/health/live
curl -i https://rss-panel.habersoft.com/status-api/health/ready
curl -i https://rss-panel.habersoft.com/admin-auth/session
ADMIN_AUTH_SMOKE_USERNAME="<redacted>" ADMIN_AUTH_SMOKE_PASSWORD="<redacted>" npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
npm run verify:operator-ergonomics
npm run verify:production-overlay-canonicalization
```

This is no authenticated admin-shell acceptance claim. If the helper reports `backend_network_required_for_service_dns`, set `ADMIN_UI_BACKEND_DOCKER_NETWORK` in the operator-owned frontend env and rerun config before recreate. If `invalid_upstream_origin` or `public_edge_upstream_rejected` appears, do not use 127.0.0.1 or public edge hosts inside Docker bridge; use backend service alias via `compose.backend-network.yaml` or proven host-gateway reachability.

## Browser Safety Boundary

The admin UI must not use `localStorage`, `sessionStorage`, `IndexedDB`, `cookieStore`, or `document.cookie` for auth persistence. The browser must not receive an Agent `X-Agent-Key`, Tenant bearer token, JWT signing material, backend upstream origin, generated password hash, session secret, Redis key, or production credential. The health dashboard remains read-only and credential-free; protected shell visibility depends only on the same-origin session status.

## Future Evidence Checklist

A later production activation receipt must include redacted evidence for:

- immutable image identity;
- remote Git SHA;
- environment variable presence, with secret values redacted;
- fail-closed session before login;
- `AUTH_CONFIGURED_UNAUTHENTICATED` for `/admin-auth/session` before login, or `AUTH_NOT_CONFIGURED_RESIDUAL` if it regresses to `501 not_configured`;
- login/session/logout smoke as redacted regression/sanity evidence;
- `/status-api/health/live` and `/status-api/health/ready` through the panel path;
- generated frontend Nginx config contains `/admin-api/operations/summary`, contains no unresolved `__ADMIN_UI_` markers, and does not fall through to SPA HTML for `/admin-api`;
- protected shell locked, unlocked, and locked-after-logout behavior;
- no Agent/Tenant credential exposure;
- rollback image/env identity;
- no raw logs, raw secrets, raw production response bodies, or production credential collection in Git.

## Operator-Managed Deployment Boundary

Before any server mutation, the operator must capture rollback baseline and current-state evidence according to the backend/frontend runbooks. MS-023A-R2 does not capture or infer that baseline.

The operator applies future runtime/config changes by selecting a Git SHA/image identity, rebuilding or updating the configured frontend image when Nginx templates or the entrypoint change, placing real backend admin-auth values in the backend runtime env, placing frontend runtime values in the admin UI runtime env, selecting backend-network service DNS or proven host-gateway for the admin UI proxy, keeping the admin UI bound to loopback, and configuring the external edge separately. After backend API/image/network/admin-auth env recreate, run `npm run ops:compose:recreate` from `rss-admin-ui` before auth evidence. These instructions are human/operator-managed and are not executed by Codex in MS-024E, MS-024F, MS-025A-R1, or MS-025A-R2.

Read-only status-dashboard production transport is accepted in MS-023D. Backend admin auth configured unauthenticated evidence is operator-reported in MS-024E. Authenticated admin-shell production acceptance for the current implemented scope is accepted in MS-024F by operator report. Read-only operations dashboard production acceptance is closed in MS-025A-R2 by operator report. Future business/admin write features remain separate bounded work.
