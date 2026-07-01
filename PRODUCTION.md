# habersoft-rss Production Guide

This root guide owns product-level production boundaries for the `habersoft-rss` repository. It does not replace the project-owned guides:

- Backend: [`rss-habersoft-com/PRODUCTION.md`](rss-habersoft-com/PRODUCTION.md)
- Admin UI: [`rss-admin-ui/PRODUCTION.md`](rss-admin-ui/PRODUCTION.md)

Topology classification: `POLYREPO_STYLE_SINGLE_GIT_MONOREPO`.

Codex workspace hygiene is governed by [`CODEX_WORKSPACE_POLICY.md`](CODEX_WORKSPACE_POLICY.md). MS-020E requires new Codex temporary workspaces, clones, worktrees, test folders, build outputs, package outputs, and task caches to live under `E:\Codex\rss-habersoft-com\workplace\`. This is not a production path migration and does not move production checkout ownership.

## Current Status

| Project | Production status | Deployment status |
|---|---|---|
| `rss-habersoft-com` | `MVP - Production Active` | Existing backend runtime remains untouched |
| `rss-admin-ui` | `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED` | MS-024F status/auth shell remains operator-reported accepted; MS-025A-R2 closes read-only operations summary dashboard production acceptance by operator report; MS-025B-R1 closes read-only drilldown production acceptance by operator report; MS-026A route/proxy/auth/HTML-fallback smoke is operator-reported deployed under MS-026B; MS-026C improves one-command retest and browser evidence only; feed recheck effect remains pending because production has no eligible feed/actionRef |

MS-020A performed repository topology migration and local workspace cutover only. MS-020B added a local/tested read-only admin status dashboard contract and frontend slice. MS-020C adds a local/tested same-origin health transport and local full-stack rehearsal for that dashboard. MS-020D packages the production activation readiness contract, operator authority template, future evidence checklist, and local readiness verifier. MS-021A adds a frontend-only fail-closed protected admin/business shell foundation. MS-021B adds only a same-origin admin session sentinel and fail-closed auth-status client. MS-022A adds a disabled-by-default local admin auth/session foundation and exact same-origin auth proxy activation, while `rss-admin-ui` remains not deployed. MS-022B adds secretless admin auth provisioning helpers, local production-mode RC acceptance, and operator handoff docs for a future activation milestone. MS-023A-R2 adds the operator-managed production configuration/proxy package, local verifier, and runbook guidance while preserving the `NOT_DEPLOYED` claim boundary. MS-023B adds the status-api internal-upstream remediation package for an operator-reported install where `/healthz` works but `/status-api/health/ready` is blocked by a public-edge upstream. MS-023C adds the production Docker bridge networking remediation package for the operator-reported `127.0.0.1:3200` container-loopback upstream misconfiguration. MS-023D records operator-reported plus Codex public read-only verification that `/healthz`, `/status-api/health/live`, and `/status-api/health/ready` are production-active for the read-only status dashboard transport, while `/admin-auth/session` historically remained `AUTH_NOT_CONFIGURED_RESIDUAL`. MS-024A lands the auth enablement package, redacted smoke tooling, backend env-file validation, and CORS-header stripping proxy hardening without production mutation. MS-024B is a repository-only operator ergonomics remediation for the operator-reported `admin-auth-smoke: fetch failed`, Compose inspection, and restart-loop blockers. MS-024C canonicalizes the frontend production backend-network overlay/helper path, keeps plain Compose as inspection/degraded-only for service-DNS topologies, and improves no-crash proxy startup plus backend-auth residual diagnostics. MS-024D lands backend production Compose env wiring so admin-auth variables supplied by operator env files reach `main-service-api`, verifies the worker does not receive them, and adds redacted backend diagnostics. MS-024E intakes operator-reported evidence that backend admin-auth is configured, the frontend proxy recovered after canonical helper recreate, and `/admin-auth/session` returns `AUTH_CONFIGURED_UNAUTHENTICATED`. MS-024F records operator-reported authenticated admin shell production acceptance after the MS-024E retest residual. MS-025A adds the local protected read-only operations dashboard package at `GET /admin-api/operations/summary`; MS-025A-R1 remediates the operator-reported follow-up where the running frontend image served SPA HTML for `/admin-api/operations/summary`; the generated Nginx config under `/tmp/nginx/conf.d/default.conf` is now locally verified to contain the admin-api route before the SPA fallback. MS-025A-R2 records operator-reported production acceptance for the read-only operations summary dashboard and R1 proxy-template remediation. MS-025B adds protected read-only operations drilldown at `GET /admin-api/operations/drilldown`, with exact proxy routing, manual refresh, and no polling; MS-025B-R1 closes drilldown production acceptance by operator-reported live retest evidence. MS-026A adds only `POST /admin-api/operations/feed-recheck-requests` for a bounded feed recheck request action and leaves operator deploy/retest required. These milestones do not SSH to production, run production `git pull`, restart containers, rebuild a production image, publish an image, create a Git tag, create a GitHub Release, create a PR, capture rollback baseline for the operator, mutate production environment files, or perform Codex credentialed login.

Explicit path migration status:

`PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A`

## Deployment Order Boundary

Future production deployment must be authorized as a separate milestone. The operator should deploy in this order only after fresh preflight and evidence gates:

1. Update the server checkout model for the root repository.
2. Enter the backend project root for backend deployment.
3. Re-run backend production preflight, backup, and evidence checks required by the backend guide.
4. Deploy the admin UI separately only after an approved frontend deployment milestone.

Future target checkout layout, not current production state:

```text
/opt/habersoft-rss/rss-habersoft-com
/opt/habersoft-rss/rss-admin-ui
```

Do not claim the running host has already migrated to that layout until the operator performs and verifies it.

## Environment Ownership

Backend production environment variables, image identity, database/Redis/JWKS contracts, backup/restore, rollout, rollback, and evidence receipts are owned by [`rss-habersoft-com/PRODUCTION.md`](rss-habersoft-com/PRODUCTION.md).

Admin UI runtime config, read-only health dashboard behavior, same-origin health transport, protected admin shell boundary, activation readiness classification, secretless activation package, future authority template, static image delivery, reverse-proxy expectations, and frontend rollback are owned by [`rss-admin-ui/PRODUCTION.md`](rss-admin-ui/PRODUCTION.md).

MS-023A-R2/MS-023B/MS-023C/MS-023D/MS-024A responsibility split:

- rollback baseline is operator-managed and must be captured by the operator before any server mutation;
- server deployment/configuration is operator-managed, including server checkout, Docker/Compose, env placement, DNS/TLS/OpenLiteSpeed/firewall, and service restart/reload decisions;
- Codex-owned repository work is limited to secretless templates, same-origin proxy configuration, internal-upstream validation, production networking guardrails, local synthetic validation, and runbook guidance;
- MS-023D accepts only read-only status-dashboard production transport and does not change the backend's accepted production evidence series.
- MS-024A prepared authenticated admin activation inputs and local evidence tooling only; at that historical point production admin auth was pending operator backend runtime env placement and `main-service-api` restart/recreate.
- MS-024D wires backend admin-auth env names into `main-service-api` in production Compose; operator-owned secret values and the actual `main-service-api` recreate remain operator-managed.
- MS-024E records operator-reported configured unauthenticated admin-auth evidence; MS-024F records operator-reported authenticated admin shell acceptance for the current implemented scope.
- MS-025A adds repository code/docs/tests for the protected read-only operations overview and summary API. Its local package status remains preserved as history.
- MS-025A-R1 adds repository code/docs/tests for the admin-api proxy template/generated-config remediation. Production source pull must be paired with a frontend image rebuild/update before frontend recreate; that residual is now closed by MS-025A-R2 operator-reported retest evidence.
- MS-025A-R2 closes the read-only operations dashboard production acceptance by operator report only. No production deployment was performed by Codex.
- MS-025B adds repository code/docs/tests for the protected read-only operations drilldown API and UI. Its status is `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`; drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. No production deployment was performed by Codex for MS-025B-R1.
- MS-026A adds repository code/docs/tests for one bounded feed recheck action at `POST /admin-api/operations/feed-recheck-requests`. Its status is `MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`; No production deployment was performed by Codex for MS-026A.
- MS-026B records operator-reported MS-026A deploy/retest route smoke as `MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET`. Health, status, auth, summary, drilldown, exact feed-recheck route, JSON 404/405/401, and no HTML fallback checks passed by operator report. Production had zero feeds and no drilldown rows, so feed recheck effect is `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` / `PENDING_NO_ELIGIBLE_TARGET`; no production feed was created, seeded, faked, or requested.
- MS-026C adds `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED`: one-command `npm run ops:production:retest`, redacted browser evidence export/verification, `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`, `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and the future closure path for `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`. Codex still does not mutate production, read secrets, perform credentialed login, seed feeds, create tags, releases, or PRs.

MS-023D live status-dashboard result:

- bounded status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`;
- accepted: `https://rss-panel.habersoft.com/healthz`, `/status-api/health/live`, and `/status-api/health/ready` return safe accepted responses;
- residual: `https://rss-panel.habersoft.com/admin-auth/session` returns HTTP `501` with `status=not_configured`, classified as `AUTH_NOT_CONFIGURED_RESIDUAL`;
- meaning: the read-only status-dashboard transport is accepted, but authenticated admin-shell production acceptance remains blocked;
- next operator action: verify backend runtime admin-auth env placement and `main-service-api` restart/recreate under the operator rollback plan; do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`;
- runbook: [`rss-admin-ui/.docs/live-status-dashboard-acceptance.md`](rss-admin-ui/.docs/live-status-dashboard-acceptance.md) and [`rss-admin-ui/.docs/status-api-upstream-remediation.md`](rss-admin-ui/.docs/status-api-upstream-remediation.md).

MS-024A auth enablement package result:

- bounded status: `MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR`;
- MS-023D status-dashboard production transport remains accepted;
- `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream;
- placing values only in `rss-admin-ui/.env.production` is insufficient; backend admin-auth values must be visible to the backend API service runtime;
- next operator action: backend runtime admin-auth env placement and `main-service-api` restart/recreate under the operator rollback plan;
- validation: `npm run verify:ms024a-auth-enablement-package`, `npm run test:admin-auth-smoke-redacted`, and operator-managed `npm run auth-smoke:redacted` with credentials supplied only through environment variables.

MS-024F authenticated admin UI production acceptance is closed for the current implemented status/auth shell scope by operator report. The evidence source is `operator_reported`; Codex did not independently perform a credentialed login, read or hash real admin credentials, mutate production, or capture rollback baseline. Future business/admin write features are not accepted and require a separately bounded milestone.

MS-025A authenticated read-only admin operations dashboard package:

- bounded status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`;
- browser/backend route: `GET /admin-api/operations/summary`;
- authenticated session requirement: existing same-origin admin auth session; no Tenant bearer, Agent key, Authorization bearer, or browser credential persistence;
- session cookie path: `Path=/` with `HttpOnly`, `SameSite=Lax`, and production `Secure`; login and logout clear historical `Path=/admin-auth` cookies;
- response shape: aggregate `dependencies`, `feeds`, `entries`, `ingestion`, `window`, `generatedAt`, and safe `notes`;
- excluded data: tenant identifiers, feed URLs, entry content, raw logs, raw upstream response bodies, private hostnames, cookies, password hashes, session secrets, database/Redis URLs, Agent keys, Tenant tokens, and write controls;
- proxy contract: exact route allowlist, GET-only, unknown `/admin-api/**` returns safe `404`, non-GET returns safe `405`, query strings are not forwarded, `Set-Cookie` and upstream CORS headers are hidden on the data route;
- historical operator boundary: after pulling a SHA that contained MS-025A, recreate the backend API/image/runtime under the backend rollback plan if required, then run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate` before testing the frontend edge route;
- historical acceptance boundary: no MS-025A live production acceptance was claimed by that repository package.

MS-025A-R1 admin-api proxy template remediation:

- bounded status: `MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`;
- operator-reported blocker: production `/admin-api/operations/summary` returned HTTP 200 `text/html` with SPA `index.html` fallback because the running frontend image template lacked the active admin-api insertion marker;
- repository proof: `npm run test:admin-api-proxy-template` builds/runs the frontend image, inspects `/tmp/nginx/conf.d/default.conf` and `nginx -T`, verifies no unresolved `__ADMIN_UI_*__` markers, verifies route order before `location /`, and verifies tested `/admin-api/*` paths return JSON rather than HTML;
- historical operator boundary: pulling source is not enough for Nginx template or entrypoint changes; rebuild/update the frontend image, run the canonical backend-network recreate helper, verify the running effective config contains `/admin-api/operations/summary`, then retest the UI;
- historical acceptance boundary: no MS-025A operations dashboard live production acceptance was claimed until operator evidence after the remediated image/config retest.

MS-025A-R2 operations dashboard production acceptance closeout:

- bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- operator-reported evidence: `GET /healthz -> 200 OK`, `GET /status-api/health/live -> JSON 200`, `GET /status-api/health/ready -> JSON 200`, unauthenticated `GET /admin-api/operations/summary -> JSON 401`, unknown `GET /admin-api/foo -> JSON 404`, after browser sign-in, the Operations Overview screen displayed successfully, after browser sign-in, JSON aggregate summary data loaded successfully, `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`, and logout returned the UI to locked / unauthenticated state;
- meaning: read-only operations dashboard production acceptance is closed, admin-api production proxy/template remediation is accepted, status dashboard production scope remains accepted, and authenticated admin shell production scope remains accepted;
- auth-smoke classification: `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails; credentials must be environment variables only and must not be logged;
- scope boundary: Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load. Codex did not independently perform a credentialed production login, did not read real credentials, did not mutate production, and did not accept write/business features;
- runbook posture: No current MS-025A/R1 operator retest residual remains. Future regression checks may still use `npm run ops:compose:recreate`, `npm run auth-smoke:redacted`, browser login/logout sanity, and `/admin-api/operations/summary` unauthenticated and authenticated checks;
- artifact posture: durable operator-state receipt outside Git records this intake; temporary workplace paths are not durable operator artifacts.

MS-025B authenticated read-only operations drilldown package:

- bounded status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- browser/backend route: `GET /admin-api/operations/drilldown`;
- authenticated session requirement: existing same-origin admin auth session; no Tenant bearer, Agent key, Authorization bearer, or browser credential persistence;
- request behavior: one authenticated initial load plus manual refresh only, no polling, no freeform query/search, bounded timeout/abort, and stale-result guards;
- response shape: top-level `status`, `generatedAt`, `window.recentHours=24`, `window.maxRows=20`, feed counts and feed rows, ingestion counts and ingestion rows, safe notes, and capabilities;
- safe fields: opaque `displayId`, safe `displayName`, public `sourceHost`, feed `health`, `lastCheckedAt`, `lastResult`, safe counts, `receivedAt`, bounded row status, and safe notes;
- excluded data: raw feed URL paths or queries, entry content, entry URLs, raw logs, raw request/response bodies, private hostnames, tenant identifiers, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, stack traces, and write controls;
- proxy contract: exact route allowlist, GET-only, unknown `/admin-api/**` returns safe `404`, non-GET returns safe `405`, query strings are not forwarded, request bodies are not forwarded, `Set-Cookie`, `WWW-Authenticate`, and upstream CORS headers are hidden on the data route;
- validation: `npm run verify:admin-operations-drilldown`, `npm run verify:production-operations-drilldown-acceptance`, `npm run test:admin-api-proxy-template`, `npm run test:admin-operations-proxy`, `npm run test:fullstack`, and `npm run test:production-mode-rc`;
- operator boundary: MS-025A-R2 remains accepted for the existing operations summary dashboard. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. No production deployment was performed by Codex for MS-025B-R1.

MS-025B-R1 operations drilldown production acceptance closeout:

- bounded status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- accepted scope: authenticated read-only Operations Drilldown dashboard;
- preserved accepted scopes: MS-023D status dashboard accepted, MS-024F authenticated admin shell accepted by operator report, and MS-025A-R2 read-only operations summary dashboard accepted by operator report;
- operator-reported evidence: Backend image was rebuilt; Migration control/check passed; main-service-api and main-service-worker were recreated; Frontend image was rebuilt; Current latest-tag pattern was preserved; Frontend was recreated with the canonical helper; `GET /healthz -> 200 OK`; `GET /status-api/health/live -> JSON 200`; `GET /status-api/health/ready -> JSON 200`; unauthenticated `GET /admin-api/operations/drilldown -> JSON 401`; `GET /admin-api/foo -> JSON 404`; running Nginx config contained both `/admin-api/operations/drilldown` and `/admin-api/operations/summary`; running Nginx config had no unresolved `__ADMIN_UI_` markers; Operations Overview rendered successfully; Operations Drilldown rendered successfully; Drilldown JSON data loaded successfully; sign out returned the drilldown route to the unauthenticated/locked state; No secret, cookie, or session value was shared;
- claim boundary: operator-reported MS-025B-R1 live retest evidence only; Codex did not independently perform a credentialed production login, did not contact production for credentialed verification, did not read real credentials, did not mutate production, and did not accept write/business features;
- auth-smoke classification: auth-smoke without credentials remains a sanity observation, not a blocker; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails;
- artifact posture: durable operator-state receipt outside Git records this intake; temporary workplace paths are not durable operator artifacts;
- residual boundary: current read-only Operations Drilldown scope is closed by operator report. future admin write/business features are not accepted, and write/business features remain separate bounded milestones.

MS-026A bounded admin feed recheck action:

- bounded status: `MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED`;
- new exact action route: `POST /admin-api/operations/feed-recheck-requests`;
- read route extension: `GET /admin-api/operations/drilldown` may include `canRequestRecheck`, `recheckUnavailableReason`, and opaque `actionRef` metadata for eligible rows;
- action semantics: authenticated admin only, JSON only, explicit confirmation in the UI, CSRF via `X-Admin-CSRF`, idempotency via `X-Admin-Idempotency-Key`, 300 second target cooldown, and safe JSON response statuses;
- backend behavior: validates the opaque target, public source host, active feed, subscriber count, and existing due-feed path, then moves only that feed's `nextCheckAt` to the request time;
- safety boundary: no synchronous external feed fetch, no raw feed URL path/query in the browser, no Agent key, no Tenant bearer token, no entry mutation, no feed CRUD, no tenant management, no arbitrary admin writes, and no backend migration;
- proxy contract: exact allowlist route, POST-only, 2k body limit, query stripping, only `Cookie`, `Content-Type: application/json`, `X-Admin-CSRF`, and `X-Admin-Idempotency-Key` action headers forwarded, upstream `Set-Cookie`, `WWW-Authenticate`, and CORS headers hidden;
- validation: `npm run verify:admin-feed-recheck-action`, `npm run test:admin-api-proxy-template`, `npm run test:fullstack`, and `npm run test:production-mode-rc`;
- residual: operator deploy/retest required. Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets.

MS-026B operator automation and no-eligible-target closeout:

- bounded status: `MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET`;
- operator-reported MS-026A smoke: backend/frontend rebuilt and recreated, migration check passed, health endpoints passed, running Nginx exact routes contained summary/drilldown/feed-recheck, unknown `/admin-api/foo` returned JSON `404`, feed-recheck `GET` returned JSON `405`, unauthenticated feed-recheck `POST` returned JSON `401`, browser login succeeded, and Operations Overview/Drilldown loaded;
- claim boundary: feed recheck effect acceptance is not closed because production reported `feeds.total=0`, `active=0`, and `drilldown rows=[]`; classification is `NO_ELIGIBLE_FEED_RECHECK_TARGET`, effect status is `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` / `PENDING_NO_ELIGIBLE_TARGET`;
- automation: frontend `npm run ops:production:retest:redacted` is dry-run/diagnose by default, `npm run ops:production:acceptance:redacted` performs redacted route smoke when the operator supplies an endpoint, and `npm run ops:feed-recheck:eligibility:redacted` classifies eligible/no-eligible feed targets; authenticated checks use environment credentials only;
- apply guardrails: frontend mutation requires `npm run ops:compose:recreate -- --apply`; backend API/worker recreate guidance is `npm run ops:production:recreate:api-worker -- --dry-run` and `npm run ops:production:recreate:api-worker -- --apply`;
- risk tiers: CRITICAL always fails closed for secret/session/cookie/CSRF/token exposure, browser persistence, unsafe auth/write boundaries, admin API HTML fallback, production mutation by Codex, real secret reads, and unsafe production upstreams; HIGH blocks apply but permits local dry-run diagnostics for missing env/image files, invalid upstreams, unresolved templates, or missing action proxy; MEDIUM warns/degrades for absent smoke credentials, no eligible feed target, local Docker absence in non-critical checks, and host Node/npm warnings when Docker Node 24 validation passes; LOW is informational for npm/Prisma notices and CRLF checkout warnings.

MS-026C one-command operator automation and browser evidence bridge:

- bounded status: `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED`;
- operator command: `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:production:retest -- --dry-run`, then `--retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>` or `--apply` when the operator intends backend/frontend recreate;
- evidence bridge: authenticated admins copy redacted browser evidence from Operations Drilldown and run `npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>`;
- local verifiers: `npm run verify:operator-automation` and `npm run verify:browser-evidence`;
- effect boundary: `NO_ELIGIBLE_FEED_RECHECK_TARGET` remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` until a real eligible feed appears through normal operation and a future operator receipt reports `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`;
- safety boundary: no production mutation by Codex, no Codex credentialed login, no real secret reads, no production feed creation/seed/fake actionRef, no raw logs/raw bodies/cookies/sessions/CSRF/idempotency/actionRef values in evidence, no registry publication, no tag, no release, and no PR.

MS-024C production overlay canonicalization result:

- operator-reported: MS-024B diagnose/ps/logs helpers improved, but a plain frontend `deploy/production/compose.yaml` recreate with `main-service-api` service DNS failed with `host not found in upstream "main-service-api"` and hid `/healthz` behind a restart-loop;
- operator-reported: adding `deploy/production/compose.backend-network.yaml` made the frontend healthy and restored `/healthz` plus `/status-api/health/live`;
- repository decision: for production Docker bridge service-DNS upstreams, the canonical frontend runtime path is `npm run ops:compose:config` then `npm run ops:compose:recreate`, which includes the backend-network overlay when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured and blocks before recreate if service DNS is configured without that network input;
- plain `deploy/production/compose.yaml` remains valid for inspection-safe defaults, `docker compose config`, and degraded/no-upstream local scenarios, but it is not the complete production runtime invocation for `http://main-service-api:3000`;
- runtime proxy generation resolves upstream hosts at request time so an unresolved backend service alias does not prevent `/healthz`, `env-config.js`, or static assets from starting; exact proxy routes still fail closed with bounded JSON `502`;
- `AUTH_NOT_CONFIGURED_RESIDUAL` now maps to backend runtime admin-auth env activation classes: disabled/missing mode, missing/placeholder username, missing/placeholder/invalid password hash, missing/weak session secret, Redis/session dependency unavailable, or backend auth endpoint still reporting not configured through a reachable frontend proxy.

MS-024D backend admin-auth runtime env wiring result:

- backend production Compose maps `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, `ADMIN_UI_SESSION_TTL_SECONDS`, `ADMIN_UI_SESSION_COOKIE_NAME`, `ADMIN_UI_SESSION_COOKIE_SECURE`, and `ADMIN_UI_SESSION_REDIS_PREFIX` into `main-service-api`;
- backend production Compose intentionally does not map those variables into `main-service-worker`;
- `--env-file` is interpolation input only; service-level `environment:` mapping is what makes a value visible to a container;
- redacted diagnostics: `npm run production:admin-auth:diagnose:redacted -- --synthetic`;
- synthetic Compose wiring verifier: `npm run production:admin-auth:compose:verify`;
- after operator-owned env activation, the admin-auth-only affected backend service is `main-service-api`; worker recreate is not required solely for admin auth.

MS-024E configured unauthenticated evidence intake:

- bounded status: `MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING`;
- operator-reported: backend diagnostics passed with `ADMIN_AUTH_SINGLE_ADMIN_CONFIG_PRESENT`, API env wired, and worker `worker_absent_by_design`;
- operator-reported: backend container loopback and host loopback `/admin-auth/session` returned `configured=true`, `authenticated=false`, `reason=unauthenticated`;
- operator-reported: the first frontend edge retest failed with status-api `502`/auth unavailable because the frontend retained stale backend upstream/network references after backend recreate;
- required guardrail: after backend API/image/network/admin-auth env recreate, run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`;
- operator-reported: frontend proxy recovered after canonical overlay helper recreate; `/healthz`, `/status-api/health/live`, `/status-api/health/ready`, and `/admin-auth/session` passed through the frontend edge, and `auth-smoke:redacted` returned `AUTH_CONFIGURED_UNAUTHENTICATED` with empty `diagnostic_classes`;
- meaning: status dashboard production scope remains accepted, backend auth env wiring is no longer the residual, and the next operator evidence is credentialed redacted login smoke.

MS-024F authenticated admin shell acceptance closeout:

- bounded status: `MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`;
- operator-reported: after MS-024E delivery, production retest was performed and authenticated admin shell production acceptance was accepted;
- source boundary: operator-reported statement only; Codex did not independently perform a credentialed login, did not use or inspect real credentials, and did not contact production with credentials;
- safety boundary: no production mutation, no live credentialed production contact, no real secret access, no registry, no Git tag, no GitHub Release, and no PR;
- accepted current scope: `/healthz`, same-origin `/status-api/health/live`, `/status-api/health/ready`, same-origin `/admin-auth/session`, `/admin-auth/login`, `/admin-auth/logout`, and protected shell entry/exit behavior as currently implemented;
- future boundary: business/admin write features, feed editing, tenant management, role/permission expansion, and future admin product slices are not accepted by this milestone;
- auth-smoke:redacted remains a redacted regression/sanity tool, not a pending acceptance blocker for the current implemented auth shell scope;
- No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.

Root Compose is for local orchestration and CI config validation. It is not a production deployment file.

The E: Codex workplace root is for Codex-created temporary task artifacts only. It does not authorize cleanup or relocation of production evidence, `.md`, `operator-state`, historical Desktop worktrees, legacy tombstone paths, or user data.

## Docker Naming

Local root Compose project name: `habersoft-rss-local`.

Backend production Compose project name remains backend-owned and unchanged. Admin UI production image naming is frontend-owned and remains template-only in MS-022A.

## Version Boundary

| Project | Version |
|---|---|
| Backend `main-service` | `0.1.0-ms-017` |
| Frontend `rss-admin-ui` | `0.1.0` |

There is no shared product version bump, backend package version bump, Git tag, GitHub Release, registry publication, or production image publication in MS-022A, MS-022B, MS-025A, or MS-025A-R2. The backend package remains `0.1.0-ms-017` because the admin auth routes are disabled by default unless explicitly configured, and the MS-025A admin operations route is protected, read-only, locally rehearsed, and accepted in production only by operator-reported browser evidence rather than by Codex production activation.

## Evidence Ownership

Accepted backend evidence remains under backend docs and ignored external `operator-state/`. The historical MS-018C through MS-019F evidence series is preserved and not reopened. MS-019F long-term stability remains `NOT_APPLICABLE_BY_GOVERNANCE_DECISION`.

## No-Secret Handling

Do not commit production secrets, DB passwords, Agent keys, JWTs, private keys, raw production evidence bodies, or private host credentials. Runtime env files remain untracked. Local examples must use placeholders or non-secret synthetic values.

## Rollback Ownership

Backend rollback is controlled by the backend production guide and must preserve immutable image identity and operator evidence. Admin UI rollback is controlled by the frontend production guide and is not active until the UI is deployed in a later milestone. MS-023A-R2 documents the rollback-baseline requirement but does not capture or infer a baseline.
