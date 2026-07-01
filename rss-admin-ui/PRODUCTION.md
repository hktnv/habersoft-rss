# rss-admin-ui Production Guide

Status: `SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED`.

This guide owns the frontend delivery contract for `rss-admin-ui`. MS-022A adds a local/tested same-origin admin auth/session foundation on top of the protected shell foundation. MS-022B adds the secretless production activation package, local production-mode RC acceptance, and operator handoff docs for a later authorized milestone. MS-023A-R2 prepares the operator-managed production configuration/proxy package and runbook guidance. MS-023B remediates the operator-reported public-edge status-api upstream blocker. MS-023C remediates the operator-reported production Docker bridge container-loopback upstream misconfiguration. MS-023D records read-only live production status-dashboard transport acceptance and classifies admin auth as not configured. MS-024A prepares the operator auth enablement package and same-origin proxy hardening while production admin auth remained pending operator backend runtime changes. MS-024B adds operator ergonomics, auth-smoke diagnostics, and graduated guardrails after the operator-reported latest recreate blocker. MS-024C canonicalizes backend-network overlay usage for production service-DNS upstreams, adds no-crash request-time proxy resolution for missing service DNS, and points `AUTH_NOT_CONFIGURED_RESIDUAL` to backend runtime auth activation diagnostics. MS-024D lands the backend production Compose env mapping needed for that activation path. MS-024E records operator-reported configured unauthenticated auth-session evidence after frontend helper recreate. MS-024F records the operator-reported production retest statement that authenticated admin shell production acceptance is closed for the implemented status/auth shell scope at that time. MS-025A adds the first authenticated read-only admin operations dashboard package locally. MS-025A-R1 remediates the operator-reported admin-api proxy template/generated-config blocker by proving the generated route exists in `/tmp/nginx/conf.d/default.conf` and never falls through to SPA HTML. MS-025A-R2 closes read-only operations summary dashboard production acceptance and the R1 proxy-template residual by operator report. MS-025B adds authenticated read-only Operations Drilldown locally at `GET /admin-api/operations/drilldown`; drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. MS-026A adds the bounded feed recheck request action at `POST /admin-api/operations/feed-recheck-requests`. MS-026B records operator-reported MS-026A route/proxy/auth/HTML-fallback smoke while preserving the pending feed recheck effect boundary because production had no eligible feed/actionRef. MS-026C adds one-command operator promotion/retest automation, redacted browser evidence verification, and a future closure flow for real eligible feed targets. MS-026C-R1 closes that automation/retest residual by operator report only while keeping feed recheck effect pending. MS-027A adds authenticated admin feed onboarding at `POST /admin-api/operations/feed-onboarding-requests`. MS-027A-R1 remediates source-changing image promotion freshness. MS-027A-R2 closes production promotion/image-freshness and feed-onboarding route-smoke acceptance by operator report only. No production deployment or credentialed login is performed by Codex.

Historical note: MS-020B supersedes the MS-020A `FOUNDATION_ONLY` state. `FOUNDATION_ONLY` is not the current frontend status token.

## Runtime Boundary

`rss-admin-ui` serves static assets, writes a bounded `env-config.js` file at container start, and renders an Nginx config for exact same-origin health, auth, and admin-api routes. Required runtime settings are:

```text
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` is server-only. It must be an absolute HTTP(S) internal backend origin with no userinfo, path, query, fragment, shell metacharacters, or production default. It must be reachable from inside the admin UI proxy runtime and must not point to public Habersoft edge hostnames such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the production Docker bridge package it must not use container-local or unspecified hosts such as `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`. It is not written to browser `env-config.js`, static assets, HTML, or UI output. The frontend must not embed backend secrets, `AGENT_KEY`, JWT signing material, database URLs, or private host credentials.

`ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is server-only and optional. If absent, `/admin-auth/**` stays in the MS-021B static fail-closed not_configured mode. If present, only `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` are proxied to the configured origin. In production it must use an internal backend origin from the same topology decision as health, not the public backend edge. Unknown auth paths return `404`; wrong methods return `405`; query strings are stripped.

MS-025A maps `GET /admin-api/operations/summary` through `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. MS-025B maps `GET /admin-api/operations/drilldown` through the same server-only origin. Both read routes are exact allowlist only, GET-only, and read-only. MS-026A maps `POST /admin-api/operations/feed-recheck-requests`; MS-027A maps `POST /admin-api/operations/feed-onboarding-requests`. Unknown `/admin-api/**` paths return safe `404`, non-GET methods return safe `405`, query strings are stripped, read-route request bodies are not forwarded, the feed recheck body is capped at 2k, and the feed onboarding body is capped at 4k. Bounded action routes forward only `Cookie`, `Content-Type: application/json`, `X-Admin-CSRF`, and `X-Admin-Idempotency-Key` plus minimal proxy headers. Authorization, Proxy-Authorization, Tenant bearer, Agent key, and custom credential-like headers are not forwarded. Upstream `Set-Cookie`, `WWW-Authenticate`, and `Access-Control-*` response headers are hidden on these data routes.

MS-025A-R1 records the operator-reported blocker where `/admin-api/operations/summary` returned HTTP 200 `text/html` with the SPA fallback because the running production frontend image's active template did not insert the admin-api generated route block. The active config path in this image is `/tmp/nginx/conf.d/default.conf`, included by `nginx -T`; `/etc/nginx/conf.d/default.conf` can be stock and irrelevant. The entrypoint now fails if generated config contains unresolved `__ADMIN_UI_*__` markers or lacks `location = /admin-api/operations/summary` or `location = /admin-api/operations/drilldown`, and the template contains JSON 404 routes for both `/admin-api` and `/admin-api/*` before the SPA fallback.

MS-024B changes runtime failure handling from startup rejection to graduated guardrails. The static frontend, `/healthz`, and `env-config.js` start even when a server-only upstream is missing or invalid. Unsafe upstreams are still fail-closed at exact route boundaries: missing, malformed, public edge, or Docker bridge loopback upstreams return bounded JSON `502` with `invalid_upstream_origin` or `public_edge_upstream_rejected`; unreachable internal upstreams return `upstream_unavailable`; upstream `401/403` on status health returns `upstream_forbidden`; absent auth upstream preserves `501 not_configured`. Public edge and loopback upstreams do not proxy successfully. `ADMIN_UI_STRICT_UPSTREAM_ORIGIN_VALIDATION=true` can be used in strict synthetic checks if a startup failure is desired.

MS-024C keeps that fail-closed traffic policy but removes the service-DNS restart-loop symptom. Generated proxy routes use request-time upstream resolution, so a production-like container configured with `http://main-service-api:3000` but missing the backend-network attachment should still serve `/healthz`, `env-config.js`, and static assets. Exact status/auth proxy routes return bounded JSON `502` for DNS/reachability failure without exposing the raw host, resolver message, stack trace, Nginx error page, cookie, or secret.

The read-only dashboard observes only same-origin `GET /status-api/health/live` and `GET /status-api/health/ready`, mapped by the frontend runtime to backend `/health/live` and `/health/ready`. It uses no `Authorization` header, no cookie credential, no bearer or Tenant token, no Agent key, no browser persistence, and no write method. The full transport contract is [.docs/same-origin-health-transport.md](.docs/same-origin-health-transport.md).

The future production activation data classification, authority record template, edge/server requirements, and post-deploy evidence checklist are [.docs/production-activation-readiness.md](.docs/production-activation-readiness.md). The operator-managed production package, live status-dashboard acceptance, status-api production networking runbook, operations dashboard/drilldown/action contract, operator handoff, MS-026C risk model, MS-026C-R1 acceptance closure, and MS-027A-R2 feed-onboarding acceptance closure are [.docs/production-activation-package.md](.docs/production-activation-package.md), [.docs/live-status-dashboard-acceptance.md](.docs/live-status-dashboard-acceptance.md), [.docs/status-api-upstream-remediation.md](.docs/status-api-upstream-remediation.md), [.docs/admin-operations-dashboard.md](.docs/admin-operations-dashboard.md), [.docs/admin-auth-production-operator-handoff.md](.docs/admin-auth-production-operator-handoff.md), [.docs/operator-risk-model.md](.docs/operator-risk-model.md), [.docs/operator-automation-acceptance.md](.docs/operator-automation-acceptance.md), and [.docs/production-feed-onboarding-acceptance.md](.docs/production-feed-onboarding-acceptance.md). MS-023D status transport is accepted; MS-024E auth-session status was `AUTH_CONFIGURED_UNAUTHENTICATED`; MS-024F authenticated admin shell acceptance is accepted by operator report for the status/auth shell scope; MS-025A-R2 operations summary dashboard production acceptance is accepted by operator report for the read-only operations scope; MS-025B-R1 operations drilldown production acceptance is accepted by operator report for the read-only drilldown scope; MS-026A route smoke is operator-reported deployed under MS-026B, MS-026C-R1 automation acceptance is closed by operator report, MS-027A-R2 feed-onboarding route smoke is accepted by operator report, and feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`.

The protected admin shell unlocks only when the same-origin session endpoint returns `authenticated: true`. MS-025A exposes only aggregate read-only operations counts and dependency states through that shell. MS-025B adds bounded drilldown rows with `maxRows=20`, opaque `displayId`, safe `displayName`, public `sourceHost`, feed health/status, ingestion status, timestamps, safe counts, safe notes, and `capabilities`. MS-026A adds only a bounded feed recheck request button for eligible feed rows. It exposes no raw feed URL paths or queries, entry content, tenant identifiers, raw logs, raw upstream bodies, private hostnames, Agent key values, Tenant bearer tokens, localStorage, sessionStorage, IndexedDB, cookieStore, document.cookie, or admin write controls beyond that bounded action. Business admin write features remain blocked until a separate authority-backed milestone defines Tenant/admin identity, role policy, authenticated field classification, and production evidence. The full boundary is [.docs/admin-auth-session-boundary.md](.docs/admin-auth-session-boundary.md), and the operations contract is [.docs/admin-operations-dashboard.md](.docs/admin-operations-dashboard.md).

MS-022A defines `GET /admin-auth/session`, `POST /admin-auth/login`, and `POST /admin-auth/logout` as the exact browser auth paths. MS-022B documents the backend production activation env variables `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and `ADMIN_UI_SESSION_COOKIE_SECURE`, plus frontend server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. The static fallback contract is [.docs/admin-session-sentinel.md](.docs/admin-session-sentinel.md).

Backend admin-auth variables must be applied to the backend API runtime. Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth. If `/admin-auth/session` returns HTTP `501 not_configured` while `/healthz` and `/status-api/health/*` pass, the next operator action is backend runtime admin-auth env placement plus `main-service-api` restart/recreate under the rollback plan, not continued changes to `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`.

For MS-024D/MS-024E, placing values only in `rss-admin-ui/.env.production` is insufficient because that file is frontend runtime input, not backend API service runtime input. `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. `/admin-auth/session -> configured=true, authenticated=false, reason=unauthenticated` means backend auth is configured before login. MS-024F records that the later production retest accepted the authenticated admin shell by operator report. Use `deploy/production/backend-admin-auth.env.template`, the backend `production.env.template` admin-auth block, and backend verifiers before operator-side backend API restart/recreate. MS-025A/MS-025B do not require a new frontend upstream variable, but after any backend API/image/network/admin-auth env recreate the frontend still must be recreated with the canonical helper before testing `/admin-api/operations/summary` or `/admin-api/operations/drilldown`.

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

Pulling Git source is not enough when `nginx.conf` or `docker-entrypoint.sh` changes. The frontend runtime image must be rebuilt locally or `RSS_ADMIN_UI_IMAGE` must be updated to an image built from the remediated source before `npm run ops:compose:recreate`; otherwise Docker can recreate a container from an older template and `/admin-api/*` can still fall through to the SPA. Before UI retest, verify the running container's effective config:

MS-027A-R1 makes that guardrail executable. For source-changing milestones, use `npm run ops:production:retest -- --apply` from `rss-admin-ui` after `git pull --ff-only origin main`; it builds backend and frontend images from current HEAD, verifies the OCI labels `org.opencontainers.image.revision` and `org.opencontainers.image.source=https://github.com/hktnv/habersoft-rss`, updates the operator image pointers, then recreates. Lower-level helpers keep `--recreate-only` as a restart-only mode and block stale images with `backend_image_stale` or `frontend_image_stale`. The local verifier is `npm run verify:production-image-freshness`.

```bash
cd /opt/habersoft-rss/rss-admin-ui
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F "/admin-api/operations/summary" && grep -F "/admin-api/operations/drilldown" /tmp/nginx/conf.d/default.conf && ! grep -F "__ADMIN_UI_" /tmp/nginx/conf.d/default.conf'
```

If that check does not find `/admin-api/operations/summary` and `/admin-api/operations/drilldown`, rebuild/update the frontend image and recreate again before browser testing. HTML from `/admin-api/*` is a regression; expected unauthenticated output is bounded JSON `401` or the documented unauthenticated JSON class.

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

MS-022A/MS-022B/MS-023A-R2/MS-023B/MS-023C do not deploy this UI and do not activate `rss-panel.habersoft.com`. MS-023D records evidence from an already operator-managed live surface; Codex did not deploy, restart, pull, edit production env, or mutate production. MS-024A likewise performs no production deployment, no registry publication, no Git tag, and no rollback-baseline capture; rollback baseline is operator-managed. MS-025B-R1 closes the read-only drilldown production acceptance by operator-reported live retest evidence, and no production deployment was performed by Codex for MS-025B-R1.

MS-026B records the operator-reported MS-026A rebuild/recreate/retest. Backend and frontend health passed, running Nginx exact routes contained `/admin-api/operations/summary`, `/admin-api/operations/drilldown`, and `/admin-api/operations/feed-recheck-requests`, unknown `/admin-api/foo` returned JSON `404`, feed-recheck `GET` returned JSON `405`, unauthenticated feed-recheck `POST` returned JSON `401`, browser login succeeded, and Operations Overview/Drilldown loaded. Production had no feeds (`feeds.total=0`, `active=0`, `drilldown rows=[]`), so the action effect remains pending: `NO_ELIGIBLE_FEED_RECHECK_TARGET` and `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. Do not create, seed, or fake a production feed/actionRef.

MS-026C adds `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED`. The one-command operator path is `npm run ops:production:retest`; default mode is dry-run, `--retest-only` performs non-mutating route/auth/admin-api checks, and `--apply` composes existing backend/frontend recreate helpers before redacted acceptance. Missing environment credentials produce `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`; authenticated browser operators can use **Copy redacted evidence** in Operations Drilldown and verify it with `npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>`. Accepted browser evidence classifications include `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and future `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`. `npm run verify:browser-evidence` and `npm run verify:operator-automation` validate the bridge locally and synthetically.

MS-026C-R1 records `SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET`. Operator-reported evidence accepted `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, and `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET` with critical risk `none` and no production contact by Codex. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`. No production feed was created, seeded, or faked. No fake actionRef was generated. The tracked guard is `npm run verify:operator-automation-acceptance`; the durable receipt is stored outside Git under `operator-state/admin-ui-production-activation/ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json`.

MS-027A records `SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`. It adds authenticated admin feed onboarding at `POST /admin-api/operations/feed-onboarding-requests`, with same-origin POST, JSON-only input, no query strings, `X-Admin-CSRF`, `X-Admin-Idempotency-Key`, explicit UI confirmation, host cooldown, and a reserved admin onboarding relation. The backend validates a public HTTPS feed URL, rejects unsafe localhost/private/internal-style targets, and performs no synchronous external feed fetch. Safe responses and evidence contain only `displayId`, public `sourceHost`, state, eligibility, safe message, and safe next steps; no raw feed URL in response or evidence is allowed. Browser evidence now includes `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, `feed_onboarding_available`, `feed_onboarding_status`, `no_eligible_target`, and `critical_risk`. Operator route smoke uses `FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED`; route proof now requires summary, drilldown, feed-recheck, and feed-onboarding. Validate with `npm run verify:admin-feed-onboarding`, `npm run test:admin-api-proxy-template`, `npm run test:fullstack`, and `npm run test:production-mode-rc`. Codex did not perform production contact or mutation. No production feed was created, seeded, or faked. MS-027A-R2 later closes the production route-smoke retest residual by operator report only.

MS-027A-R1 records `SUCCESS_MS_027A_R1_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`. It remediates the stale-image promotion failure mode: `--apply` now blocks `source_not_promoted`, builds/verifies current-HEAD backend/frontend images, and reports route/auth/effect classifications without printing credentials or raw feed material. Operator output can distinguish `backend_route_missing`, `frontend_route_missing`, `nginx_template_marker_unresolved`, `auth_not_configured`, `unauthenticated_expected`, `no_eligible_feed_target`, and `accepted_route_smoke_pending_effect`.

MS-027A-R2 records `SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED`. Operator-reported evidence accepted `OPERATOR_PROMOTION_RETEST_REDACTED_OK`, `NGINX_ROUTE_PROOF_ACCEPTED`, `browser-evidence-verify-ok`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE`, `MS-027A-R2_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_ACCEPTED_OPERATOR_REPORTED`, and `MS-027A-R2_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED_OPERATOR_REPORTED`; image freshness accepted; backend runtime image revision matched current HEAD; frontend runtime image revision matched current HEAD; feed onboarding route smoke accepted; authenticated browser evidence accepted. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`; Feed recheck effect acceptance remains future work requiring a naturally existing eligible target and redacted browser evidence. No production feed was created, seeded, or faked. No fake actionRef was generated. There was no production contact by Codex. The tracked guard is `npm run verify:production-feed-onboarding-acceptance`, and the durable receipt is stored outside Git under `operator-state/admin-ui-production-activation/ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json`.

Feed recheck effect acceptance remains future work requiring a real eligible production feed, one explicit bounded operator action for that displayed eligible target, and redacted browser evidence verified without secrets, cookies, sessions, CSRF tokens, idempotency keys, actionRefs, raw feed URLs, raw bodies, or raw logs.

Consolidated MS-026B operator path:

```bash
cd /opt/habersoft-rss
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/main

cd /opt/habersoft-rss/rss-habersoft-com
npm run production:admin-auth:diagnose:redacted
npm run ops:production:recreate:api-worker -- --dry-run
# Operator-owned mutation, only after rollback/current-state evidence:
npm run ops:production:recreate:api-worker -- --apply

cd /opt/habersoft-rss/rss-admin-ui
npm run ops:production:retest -- --dry-run
npm run production:diagnose:redacted
npm run ops:compose:config
npm run ops:compose:recreate
# Operator-owned mutation, only when recreate is intended:
npm run ops:compose:recreate -- --apply
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:production:retest:redacted
npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com
npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com
npm run verify:admin-feed-onboarding
npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>
npm run verify:browser-evidence
```

Authenticated smoke uses only `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` environment variables. The feed recheck action attempt is never automatic; it requires an authenticated eligible `actionRef` and `--attempt-feed-recheck`. If no eligible actionRef exists, report only `NO_ELIGIBLE_FEED_RECHECK_TARGET`; do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets.

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

`https://rss-panel.habersoft.com/admin-auth/session -> 501 not_configured` was classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. It was not a blocker for read-only status-dashboard closure, but it was the authenticated admin-shell production acceptance residual later resolved through MS-024E configured-auth evidence and MS-024F operator-reported authenticated-shell acceptance.

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

`AUTH_CONFIGURED_UNAUTHENTICATED` is the expected no-cookie, pre-login state recorded by MS-024E. MS-024F closes the current authenticated admin shell acceptance residual by operator report. MS-025A-R2 also classifies `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED` without credentials as an observation/sanity result, not a pending blocker for the read-only operations dashboard closeout. For regression/sanity checks, operators may still run redacted credential login smoke using only environment variables:

```bash
ADMIN_AUTH_SMOKE_USERNAME="<operator-owned>" \
ADMIN_AUTH_SMOKE_PASSWORD="<operator-owned>" \
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Report only the redacted classification, such as `AUTHENTICATED_ADMIN_ACCEPTED` or `AUTH_LOGIN_ATTEMPT_FAILED`; do not paste credentials, cookies, session IDs, password hashes, session secrets, raw logs, or raw response bodies. This smoke is no longer a pending acceptance blocker for the current implemented auth shell scope unless new contradictory evidence appears.

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

## MS-024F Authenticated Admin Shell Acceptance

Bounded status: `MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`.

Browser status label: `AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`.

MS-024F records the latest operator-reported production retest statement: after MS-024E delivery, production retest was performed and the authenticated admin shell was accepted in production.

Accepted current scope:

- public/loopback `/healthz` availability;
- same-origin `/status-api/health/live` and `/status-api/health/ready` status dashboard transport;
- same-origin `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout` flow as implemented;
- protected shell entry/exit behavior for the current read-only status dashboard surface.

Evidence source boundary:

- source type: `operator_reported`;
- Codex did not independently perform a credentialed login;
- Codex did not read, hash, print, copy, or persist real admin credentials, cookies, session IDs, password hashes, session secrets, Redis keys, raw production logs, or raw response bodies;
- Codex did not mutate production, restart/recreate containers, edit env files, publish images, create a Git tag, create a GitHub Release, create a PR, or capture rollback baseline.

Future boundary:

- future business/admin write features are not accepted;
- feed editing, tenant management, role/permission expansion, broader authenticated field classification, and admin product slices require separate bounded milestones;
- No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.

## MS-025A Read-Only Operations Dashboard

Bounded status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`.

MS-025A adds the first protected read-only admin business slice after MS-024F. It is locally accepted with synthetic credentials and local Docker/full-stack checks. MS-025A-R2 records later operator-reported production acceptance for the read-only operations route.

Browser/backend route:

```text
GET /admin-api/operations/summary
```

Implemented response fields:

```text
status
generatedAt
window.recentHours
dependencies.postgres
dependencies.redis
dependencies.tenantAuth
feeds.total
feeds.active
feeds.disabled
feeds.dueNow
entries.total
entries.createdLast24h
ingestion.checksLast24h
ingestion.successLast24h
ingestion.failedLast24h
ingestion.latestCheckAt
notes
```

The dashboard is manually refreshable only. It does not poll, persist history, use browser storage, render upstream origins, expose credentials, or add writes. The summary is aggregate-only and excludes tenant identifiers, feed URLs, raw feed/entry content, raw logs, raw request/response bodies, private hostnames, cookies, password hashes, session secrets, database/Redis URLs, Agent keys, Tenant tokens, and Authorization bearer material.

Admin session cookie path contract:

- login sets the opaque admin session cookie with `Path=/`, `HttpOnly`, `SameSite=Lax`, and production `Secure`;
- login also clears the historical `Path=/admin-auth` cookie to avoid stale path conflicts;
- logout clears both `Path=/` and `Path=/admin-auth`;
- JavaScript never reads, writes, or persists the cookie value.

Local verification commands:

```bash
npm run test:admin-operations-proxy
npm run test:admin-api-proxy-template
npm run verify:admin-operations-dashboard
npm run verify:production-operations-acceptance
npm run test:fullstack
npm run test:production-mode-rc
```

Historical operator deploy/retest boundary after pulling a SHA that contains MS-025A:

```bash
cd /opt/habersoft-rss
git pull --ff-only origin main

# Run backend deployment/recreate under the backend guide and rollback plan if the API image/runtime changes.

cd /opt/habersoft-rss/rss-admin-ui
# Rebuild/update the configured frontend image first if nginx.conf or docker-entrypoint.sh changed.
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Then the operator retests login, `/admin-auth/session`, `/admin-api/operations/summary`, the Operations Overview UI, logout, and locked-after-logout behavior. Report only redacted status classes and aggregate route status; do not paste credentials, cookies, session IDs, password hashes, session secrets, raw logs, or raw response bodies.

After MS-025A-R1, the expected live retest shape is:

```text
/healthz -> ok
/status-api/health/live -> JSON live
/status-api/health/ready -> JSON ready/up dependency states
unauthenticated /admin-api/operations/summary -> JSON 401 or documented unauthenticated JSON, not HTML
authenticated Operations Overview -> JSON-backed aggregate summary rendered
logout -> protected shell locked and /admin-api/operations/summary unauthenticated again
```

## MS-025A-R2 Operations Dashboard Production Acceptance

Bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

Source type: `operator_reported`.

Operator-reported evidence intake:

- `GET /healthz -> 200 OK`;
- `GET /status-api/health/live -> JSON 200`;
- `GET /status-api/health/ready -> JSON 200`;
- unauthenticated `GET /admin-api/operations/summary -> JSON 401`;
- unknown `GET /admin-api/foo -> JSON 404`;
- after browser sign-in, the Operations Overview screen displayed successfully;
- after browser sign-in, JSON aggregate summary data loaded successfully;
- `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`;
- logout returned the UI to locked / unauthenticated state.

Meaning:

- read-only operations dashboard production acceptance is closed;
- admin-api production proxy/template remediation is accepted;
- status dashboard production scope remains accepted;
- authenticated admin shell production scope remains accepted;
- No current MS-025A/R1 operator retest residual remains.

Auth-smoke classification:

- `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker;
- Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load;
- `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails;
- future regression tests may still use credentialed smoke, but credentials must be environment variables only and must not be logged.

Regression runbook:

```bash
npm run ops:compose:recreate
npm run auth-smoke:redacted
```

Keep browser login/logout sanity plus `/admin-api/operations/summary` unauthenticated and authenticated checks as practical regression checks. `/admin-api/*` must remain JSON fail-closed before the SPA fallback, and unknown `/admin-api/*` must not fall back to `index.html`. Durable operator-state receipt outside Git records this closeout; temporary workplace paths are not durable operator artifacts.

No production deployment was performed by Codex. Codex did not independently perform a credentialed production login, read real credentials, mutate production, publish an image, create a Git tag, create a GitHub Release, create a PR, or accept write/business features. Write/business features remain separate bounded milestones.

## MS-024A Auth Enablement Package

Bounded status: `MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR`.

MS-023D status-dashboard production transport remains accepted. MS-024A adds the operator activation package needed for the remaining auth fix without claiming authenticated admin-shell production acceptance:

- `/status-api/health/live` and `/status-api/health/ready` still proxy with no credentials and now hide upstream CORS response headers in addition to `Set-Cookie` and `WWW-Authenticate`;
- `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout` hide upstream CORS response headers while preserving intended login/logout `Set-Cookie` behavior;
- backend env-file validation supports `npm run admin-auth:verify-config -- --env-file <path> --require-enabled` with redacted output and rejects placeholders, disabled mode, missing values, invalid hashes, and short session secrets;
- `npm run auth-smoke:redacted` performs a session-only classification by default and an optional `--login-smoke` only when `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` are supplied through environment variables;
- `npm run test:admin-auth-smoke-redacted` and `npm run verify:ms024a-auth-enablement-package` validate the package locally with synthetic values.

No CORS broadening is part of this package. Redacted login/session/logout evidence remains operator-managed regression/sanity input after future backend runtime admin-auth env placement or `main-service-api` restart/recreate.

Local readiness package command:

```bash
npm run verify:production-readiness
npm run verify:production-activation-package
npm run verify:operator-managed-production-package
npm run verify:production-upstream-contract
npm run verify:production-auth-acceptance
npm run verify:operator-ergonomics
npm run verify:live-evidence-intake
npm run verify:admin-auth-not-configured-remediation
npm run verify:ms024a-auth-enablement-package
npm run verify:admin-operations-dashboard
npm run test:admin-auth-smoke-redacted
npm run test:admin-operations-proxy
npm run test:status-api-production-networking
npm run test:production-mode-rc
npm run test:status-api-upstream-remediation
npm run verify:auth-boundary
npm run test:auth-session-sentinel
npm run test:auth-proxy
```

## MS-024B operator retest checklist

Bounded status: `MS-024B_OPERATOR_ERGONOMICS_AUTH_SMOKE_REMEDIATION_READY_OPERATOR_RETEST_REQUIRED`.

This is repository remediation only. The status-dashboard scope was accepted in MS-023D, but the operator-reported latest recreate introduced a new auth/runtime blocker; no live acceptance was claimed in MS-024B. MS-024F later closes the current authenticated admin shell acceptance residual by operator report.

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

Backend production Compose now maps admin-auth values into `main-service-api` and intentionally omits them from `main-service-worker`. After backend auth env activation or any backend API/image/network/admin-auth env recreate, recreate `main-service-api` under the backend runbook, then always recreate the frontend with `npm run ops:compose:recreate` before rerunning `auth-smoke:redacted`. MS-024F records the later operator-reported authenticated shell acceptance; rerun smoke only as redacted regression/sanity evidence unless new contradictory evidence appears.

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
- authenticated `GET /admin-api/operations/summary` returns only aggregate operations fields;
- `/admin-api/operations/summary` returns no operations data before login and after logout;
- auth cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`, clears the historical `/admin-auth` path, and is `Secure` under TLS;
- browser assets and `env-config.js` contain no upstream origin, password, password hash, session secret, Agent key, Tenant bearer token, database URL, Redis credential, or private key;
- no CORS broadening was introduced;
- rollback route remains available if acceptance fails.

## Claim Boundary

MS-023D accepts the read-only status-dashboard production transport. MS-024E records that `AUTH_NOT_CONFIGURED_RESIDUAL` is resolved to `AUTH_CONFIGURED_UNAUTHENTICATED` by operator report. MS-024F records that authenticated admin shell production acceptance is closed for the status/auth shell scope by operator report. MS-025A locally accepts the protected read-only operations dashboard package, MS-025A-R1 remediates the admin-api proxy-template blocker, and MS-025A-R2 closes the read-only operations dashboard production acceptance by operator report. The claim does not include Codex credentialed login, future business/admin write features, feed editing, tenant management, role/permission expansion, long-term stability, or production mutation.
