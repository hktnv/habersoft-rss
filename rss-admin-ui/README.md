# rss-admin-ui

`rss-admin-ui` is the React/Vite admin UI project for the Habersoft RSS repository.

Status: `SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED`.

## Scope

Included through MS-027A-R2:

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
- MS-025A admin operations dashboard verifier,
- MS-025A-R2 production operations acceptance verifier and operator-reported evidence intake,
- authenticated read-only Operations Drilldown,
- same-origin `GET /admin-api/operations/drilldown` client,
- bounded feed and ingestion drilldown rows with `maxRows=20`,
- safe `displayId`, `sourceHost`, status, count, timestamp, and note fields,
- MS-025B admin operations drilldown verifier.
- MS-026A bounded admin feed recheck action verifier,
- MS-026B redacted operator automation, no-eligible feed recheck classification, and risk-tiered apply guardrails,
- MS-026C one-command operator promotion/retest automation, browser evidence bridge, and future feed-recheck closure flow,
- MS-026C-R1 operator-reported production acceptance closure for the automation/retest package while feed recheck effect remains pending,
- MS-027A authenticated admin feed onboarding route, panel, proxy, browser evidence fields, and verifier,
- MS-027A-R1 production image freshness remediation for backend/frontend promotion, stale-image classifications, and verifier,
- MS-027A-R2 operator-reported production promotion/image-freshness and feed-onboarding route-smoke acceptance verifier.

Not included:

- write-capable business pages,
- production credential provisioning,
- Codex-run production login/session activation,
- Codex-run credentialed production smoke,
- Agent authentication,
- backend writes,
- automatic polling or monitoring history,
- raw feed URL paths or queries, tenant identifiers, entry content, raw logs, or raw upstream bodies,
- production evidence projection,
- production deployment by Codex,
- admin write/business features.

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
npm run verify:production-operations-acceptance
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
npm run verify:admin-operations-drilldown
npm run verify:admin-feed-onboarding
npm run verify:operator-automation
npm run verify:operator-automation-acceptance
npm run verify:production-image-freshness
npm run verify:browser-evidence
npm run ops:production:retest -- --dry-run
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com
npm run ops:production:retest:redacted
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:browser-evidence:verify -- --file redacted-browser-evidence.json
npm run ops:compose:config
npm run ops:compose:up -- --force-recreate rss-admin-ui
npm run ops:compose:recreate -- --apply
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

MS-025A reuses `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` for the exact read-only admin-api route `GET /admin-api/operations/summary`. MS-025B reuses the same server-only upstream for `GET /admin-api/operations/drilldown`. The frontend runtime does not add a third upstream variable. Both routes are GET-only, strip query forwarding, forward only the browser's same-origin admin session cookie, hide upstream `Set-Cookie`, `WWW-Authenticate`, and CORS response headers, and return bounded JSON for unauthenticated, unavailable, wrong-method, or unknown-path cases.

MS-025A-R1 adds a generated-template regression harness for the operator-reported production blocker where the running frontend image lacked the admin-api marker in the active Nginx template and `/admin-api/operations/summary` fell through to `index.html`. The active generated config is `/tmp/nginx/conf.d/default.conf`; `/etc/nginx/conf.d/default.conf` may be stock or irrelevant. `npm run test:admin-api-proxy-template` proves the effective config contains `location = /admin-api/operations/summary` and `location = /admin-api/operations/drilldown`, contains JSON fallback routes for `/admin-api` and `/admin-api/*`, contains no unresolved `__ADMIN_UI_*__` markers, orders both admin-api routes before the SPA fallback, and returns JSON rather than SPA HTML for tested `/admin-api/*` requests.

MS-025A-R2 closes the read-only operations dashboard production acceptance from operator-reported live retest evidence. The evidence source is `operator_reported`: `GET /healthz -> 200 OK`, `GET /status-api/health/live -> JSON 200`, `GET /status-api/health/ready -> JSON 200`, unauthenticated `GET /admin-api/operations/summary -> JSON 401`, unknown `GET /admin-api/foo -> JSON 404`, after browser sign-in, the Operations Overview screen displayed successfully, after browser sign-in, JSON aggregate summary data loaded successfully, `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`, and logout returned the UI to locked / unauthenticated state. Codex did not independently perform a credentialed production login, did not mutate production, and did not read real secrets.

MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED adds Operations Drilldown locally. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. No production deployment was performed by Codex for MS-025B-R1. The drilldown performs one authenticated initial load and then manual refresh only; it uses no polling and no browser persistence in localStorage, sessionStorage, IndexedDB, cookieStore, or document.cookie. The response renders only bounded safe fields: `displayId`, `displayName`, public `sourceHost`, feed `health`, `lastCheckedAt`, `lastResult`, safe counts, `receivedAt`, status, safe notes, `capabilities`, and MS-026A action metadata. It excludes raw feed URL paths or queries, entry content, raw logs, raw request/response bodies, private hostnames, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, and no write controls beyond the bounded feed recheck request.

MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED adds bounded feed recheck action UI and proxy support. Operators can request a recheck for one eligible feed from Operations Drilldown using `POST /admin-api/operations/feed-recheck-requests`. The UI requires explicit confirmation, keeps the authenticated `csrfToken`, `actionRef`, idempotency key, and response state in memory only, sends `X-Admin-CSRF` and `X-Admin-Idempotency-Key`, and displays accepted, already-pending, rate-limited, unavailable, unauthenticated, forbidden, timeout, and safe error states. The backend uses the existing due-feed path with no synchronous external feed fetch. No production deployment was performed by Codex for MS-026A; operator deploy/retest required remains.

MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET records the operator-reported MS-026A production retest without overclaiming the action effect. The route/proxy/auth/HTML-fallback smoke is deployed by operator report, but production had zero feeds and no actionRef, so the UI and automation classify the effect as `NO_ELIGIBLE_FEED_RECHECK_TARGET` and `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` / `PENDING_NO_ELIGIBLE_TARGET`. The empty state now says "No eligible feed recheck target is currently available." and does not invent an actionRef. The lower-level operator path remains `npm run ops:production:retest:redacted`, `npm run ops:production:acceptance:redacted`, `npm run ops:feed-recheck:eligibility:redacted`, and `npm run verify:operator-automation`. Frontend recreate is dry-run by default and requires `npm run ops:compose:recreate -- --apply` for an operator-owned mutation.

MS-026C adds `npm run ops:production:retest` as the one-command operator wrapper for dry-run planning, optional operator-owned apply/recreate, redacted route acceptance, generated Nginx route proof, durable receipts, and browser evidence verification. Credential-free authenticated checks are classified as `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`, not as a failed login. The browser evidence bridge exports and verifies `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and future `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED` without cookies, sessions, CSRF tokens, idempotency keys, raw actionRefs, raw feed URLs, raw logs, raw bodies, private hostnames, or secrets.

MS-026C-R1 records `SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET` from operator-reported evidence only. The reported acceptance classes are `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, and `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`; critical risk `none`; no production contact by Codex. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. No production feed was created, seeded, or faked. No fake actionRef was generated. The tracked guard is `npm run verify:operator-automation-acceptance`, and the durable sanitized receipt is stored outside Git under `operator-state/admin-ui-production-activation/ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json`.

MS-027A adds authenticated admin feed onboarding at `POST /admin-api/operations/feed-onboarding-requests`. The panel requires explicit confirmation, keeps the raw input and CSRF/idempotency material in memory only, sends `X-Admin-CSRF` and `X-Admin-Idempotency-Key`, and renders only safe response fields. The backend validates a public HTTPS feed URL, rejects unsafe localhost/private/internal-style targets, stores a reserved admin onboarding relation, and performs no synchronous external feed fetch. Safe responses and browser evidence include only `displayId`, public `sourceHost`, state, eligibility, safe messages, and `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE` with `feed_onboarding_available`, `feed_onboarding_status`, `no_eligible_target`, and `critical_risk`; there is no raw feed URL in response or evidence. Operator automation classifies `FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED` and Nginx proof now requires summary/drilldown/feed-recheck/feed-onboarding. Status: `SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`; operator deploy/retest required remains. Codex did not perform production contact. No production feed was created, seeded, or faked. Validate with `npm run verify:admin-feed-onboarding`, `npm run test:admin-api-proxy-template`, `npm run test:fullstack`, and `npm run test:production-mode-rc`.

MS-027A-R1 adds production promotion image freshness remediation. The canonical operator path is still `npm run ops:production:retest`, but `--apply` now requires the checkout to match `origin/main`, builds backend/frontend images from current HEAD, verifies `org.opencontainers.image.revision` and `org.opencontainers.image.source`, updates the operator image pointer, and then recreates containers. `--recreate-only` is restart-only and blocks unless the existing image already matches HEAD. Operator output distinguishes `source_not_promoted`, `backend_image_stale`, `frontend_image_stale`, `backend_route_missing`, `frontend_route_missing`, `nginx_template_marker_unresolved`, `auth_not_configured`, `unauthenticated_expected`, `no_eligible_feed_target`, and `accepted_route_smoke_pending_effect`. Validate with `npm run verify:production-image-freshness`; MS-027A-R2 later closes the image-freshness and feed-onboarding route-smoke production retest residual by operator report only.

MS-027A-R2 records `SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED` from operator-reported evidence only. The reported classes are `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, `MS-027A-R2_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_ACCEPTED_OPERATOR_REPORTED`, and `MS-027A-R2_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED_OPERATOR_REPORTED`; image freshness accepted; backend runtime image revision matched current HEAD; frontend runtime image revision matched current HEAD; feed onboarding route smoke accepted; authenticated browser evidence accepted. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`; Feed recheck effect acceptance remains future work requiring a naturally existing eligible target and redacted browser evidence. No production feed was created, seeded, or faked. No fake actionRef was generated. There was no production contact by Codex. The tracked guard is `npm run verify:production-feed-onboarding-acceptance`, and the durable sanitized receipt lives outside Git under `operator-state/admin-ui-production-activation/ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json`.

MS-024B changes the operator runtime posture to graduated guardrails. Missing, malformed, public-edge, or Docker bridge loopback upstreams no longer crash-loop the static frontend container. `/healthz` and the static app start, while exact proxy routes return bounded JSON with reasons such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. Unsafe upstream traffic still does not proxy successfully. `ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION=true` remains available for strict synthetic checks.

MS-024C adds the production overlay canonicalization layer. In production Docker bridge mode, backend service DNS such as `main-service-api` resolves only when the admin UI container is attached to the backend Docker network. For that topology, `compose.backend-network.yaml` is part of the canonical runtime invocation, not an optional remembered overlay. Use `npm run ops:compose:config` and `npm run ops:compose:recreate`; the helper includes the overlay when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured and blocks before recreate with redacted guidance if a service-DNS upstream is configured without that network input. Plain `deploy/production/compose.yaml` remains useful for static inspection and degraded/no-upstream defaults, but it is not the complete production runtime path for `http://main-service-api:3000`.

Backend admin-auth variables such as `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE` are consumed by the backend API runtime, not by the frontend/admin UI runtime. Passing those backend-only variables only to the frontend/admin UI Compose command does not enable backend auth.

MS-024D lands the backend production Compose mapping for those variables into `main-service-api` and verifies that `main-service-worker` does not receive them. MS-024E records operator-reported retest evidence that backend admin-auth is configured and `/admin-auth/session` returns `configured=true`, `authenticated=false`, `reason=unauthenticated` after the frontend is recreated with the canonical overlay helper. After any backend API/image/network/admin-auth env recreate, run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` before collecting edge auth evidence. MS-024F records operator-reported authenticated admin shell production acceptance after the MS-024E retest residual. `auth-smoke:redacted` remains a redacted regression/sanity tool, not a pending acceptance blocker for the current implemented auth shell scope.

MS-025A adds a locally accepted Operations Overview that is visible only after `/admin-auth/session` returns `authenticated=true`; MS-025A-R2 records its read-only production acceptance by operator report. MS-025B adds the Operations Drilldown inside that authenticated operations area. Both perform one initial load plus manual refresh only. They never poll, persist history, store browser credentials, use Tenant bearer tokens, use Agent keys, render raw logs, raw feed URL paths, entry content, or expose write controls. If an admin-api route is unavailable after backend or network changes, the UI directs the operator to recreate the frontend with the canonical helper before retesting.

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

MS-025A-R2 closes the current production acceptance residual for this read-only slice by operator report. Future regression checks after backend API/image/network/admin-auth env recreate may still run:

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

Then use `npm run auth-smoke:redacted`, browser login/logout sanity, and `/admin-api/operations/summary` unauthenticated and authenticated checks as regression/sanity evidence without pasting credentials, cookies, raw response bodies, or logs into Git/chat/docs. `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails. Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load. Credentials must be environment variables only and must not be logged.

## Admin Operations Drilldown

The protected operations drilldown performs one initial observation and then requires manual refresh. It reads only:

```text
GET /admin-api/operations/drilldown
```

The backend response is a bounded object with `status`, `generatedAt`, `window.recentHours`, `window.maxRows`, `feeds.status`, feed aggregate counts, feed rows, `ingestion.status`, ingestion aggregate counts, ingestion rows, `notes`, and `capabilities`. Rows are capped at `maxRows=20`.

Safe fields are `displayId`, `displayName`, public `sourceHost`, feed `health`, `lastCheckedAt`, `lastResult`, `recentEntryCount`, `receivedAt`, `entryCount`, row status, and safe notes. Raw feed URL paths or queries, entry content, raw feed content, raw logs, raw request/response bodies, private hostnames, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, localStorage, sessionStorage, IndexedDB, cookieStore, document.cookie, and write controls are excluded.

MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED closes the read-only Operations Drilldown production acceptance by operator-reported live retest evidence. MS-025A-R2 remains accepted for the existing operations summary dashboard. No production deployment was performed by Codex for MS-025B-R1.

Before production retest after pulling a SHA with MS-025B, rebuild/update backend and frontend images as required by current runbooks, recreate the backend API if its runtime changed, rebuild/update the configured frontend image if Nginx template or entrypoint source changed, and run:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
```

Then verify `/healthz`, `/status-api/health/live`, `/status-api/health/ready`, unauthenticated `/admin-api/operations/drilldown` returning JSON `401`, authenticated Operations Drilldown JSON/UI data, and logout returning to locked state. `auth-smoke:redacted` without credentials may report `AUTH_CONFIGURED_UNAUTHENTICATED`; that is an observation/sanity state, not a blocker by itself.

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

MS-025A locally accepts the first protected read-only admin product slice after that shell acceptance: aggregate operations visibility only and no write controls. MS-025A-R2 records the operator-reported production acceptance closeout for that read-only slice. Future business/admin write features remain out of scope.

MS-026A and MS-027A are the only bounded write/action exceptions currently implemented. Broader future business/admin write features are not accepted: general feed CRUD, tenant management, role expansion, Agent operations, entry editing, and arbitrary admin writes remain out of scope.

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
npm run verify:admin-feed-onboarding
```

MS-025A local rehearsal commands:

```bash
docker build -t rss-admin-ui:ms023d-local .
npm run test:auth-session-sentinel
npm run test:auth-proxy
npm run test:admin-api-proxy-template
npm run test:admin-operations-proxy
npm run verify:production-operations-acceptance
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
npm run verify:admin-feed-onboarding
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
- [Operator risk model and evidence bridge](.docs/operator-risk-model.md)
- [Operator automation acceptance](.docs/operator-automation-acceptance.md)
- [Read-only status dashboard contract](.docs/read-only-status-dashboard.md)
- [Same-origin health transport contract](.docs/same-origin-health-transport.md)
