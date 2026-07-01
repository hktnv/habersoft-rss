# habersoft-rss

`habersoft-rss` is the single Git repository for the RSS product family. It uses the `POLYREPO_STYLE_SINGLE_GIT_MONOREPO` topology: one canonical remote, two first-class project roots, and root-owned orchestration/docs.

## Projects

| Project | Role | Status |
|---|---|---|
| [`rss-habersoft-com`](rss-habersoft-com/README.md) | Backend API, worker, production evidence owner | `MVP - Production Active` |
| [`rss-admin-ui`](rss-admin-ui/README.md) | Read-only admin status and operations dashboard with same-origin admin auth/session routes plus one bounded feed recheck action | `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED` |

The backend keeps its independent `package.json`, lockfile, Dockerfile, docs, production guide, evidence tooling, and release contract. The admin UI has its own manifest, lockfile, Dockerfile, docs, tests, and production delivery contract. The repository root owns cross-project navigation, local full-stack Compose, CI coordination, and topology verification.

Codex-created temporary workspaces, clones, Git worktrees, test folders, build outputs, package outputs, and task caches must follow the root [Codex workspace policy](CODEX_WORKSPACE_POLICY.md). The only active autonomous workplace root for new Codex task artifacts is `E:\Codex\rss-habersoft-com\workplace\`.

## Prerequisites

| Tool | Contract |
|---|---|
| Node.js | Backend contract: `24.17.0`; frontend supports current Node 24 LTS-compatible tooling |
| npm | Backend contract: `11`; frontend uses its own lockfile |
| Docker Engine | Required for local Compose and image checks |
| Docker Compose v2 | Required for root and project Compose validation |

## Backend Commands

Run from `rss-habersoft-com`:

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run test:auth
npm run test:production-evidence
npm run test:production-operational-smoke-evidence
npm run docs:verify
npm run repository:hygiene:verify
npm run release:verify
npm run build
npm audit --omit=dev
```

`npm run release:verify` requires the same local non-secret `DATABASE_URL` convention documented in the backend guide when Prisma validation needs one. Do not point local verification at production.

## Frontend Commands

Run from `rss-admin-ui`:

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
npm run verify:operator-automation
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
npm run auth-smoke:redacted
npm run ops:compose:ps
npm run ops:compose:logs -- rss-admin-ui
npm run production:diagnose:redacted
npm run verify:auth-boundary
npm audit --omit=dev
```

The admin UI uses fixed same-origin browser routes `/status-api/health/live`, `/status-api/health/ready`, `/admin-auth/session`, `/admin-auth/login`, `/admin-auth/logout`, protected read-only admin operations routes `GET /admin-api/operations/summary` and `GET /admin-api/operations/drilldown`, and the bounded action route `POST /admin-api/operations/feed-recheck-requests`. Its frontend runtime maps health routes to the configured server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` and maps auth plus admin-api routes through server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`. Health uses no credentials. The operations summary and drilldown use only the HttpOnly same-origin admin session cookie, strip query forwarding at the proxy, forward no Authorization, Tenant bearer, or Agent key headers, store no browser credentials in localStorage, sessionStorage, IndexedDB, cookieStore, or document.cookie, perform manual refresh only with no polling, and add no backend writes. MS-023D accepts only the read-only production status transport and `/healthz`. MS-024E intakes operator-reported evidence that `/admin-auth/session` returns `configured=true`, `authenticated=false`, `reason=unauthenticated` after frontend helper recreate. MS-024F records the operator-reported production retest that authenticated admin shell production acceptance is closed for the status/auth shell scope implemented at that time. Evidence source remains `operator_reported`; Codex did not independently perform a credentialed login, read credentials, mutate production, or capture rollback baseline. MS-025A locally accepted the first protected read-only admin operations dashboard package, MS-025A-R1 remediated the admin-api proxy template fallback blocker, and MS-025A-R2 records operator-reported production acceptance for that read-only operations dashboard scope. MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED adds the bounded drilldown route locally with `maxRows=20`, opaque `displayId`, public `sourceHost` only, and safe notes; raw feed URL paths, entry content, raw logs, secrets, Agent key values, and Tenant bearer tokens remain forbidden. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. Broader future business/admin write features are not accepted; MS-026A is only the bounded feed recheck request action.

MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED adds the first bounded admin action: an authenticated operator can request one eligible feed recheck from Operations Drilldown through `POST /admin-api/operations/feed-recheck-requests`. The action uses `X-Admin-CSRF`, `X-Admin-Idempotency-Key`, explicit confirmation, a 300 second cooldown, opaque `actionRef` values, public `sourceHost` only, and the existing due-feed path with no synchronous external feed fetch. No production deployment was performed by Codex for MS-026A, and operator deploy/retest required remains the residual. Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw feed URLs, raw logs, or secrets into evidence.

MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET records the operator-reported production rebuild/recreate/retest after MS-026A: backend/frontend health passed, exact summary/drilldown/feed-recheck Nginx routes were present, unknown `/admin-api/*` returned JSON `404`, feed-recheck `GET` returned JSON `405`, unauthenticated feed-recheck `POST` returned JSON `401`, browser login succeeded, and Operations Overview/Drilldown loaded. Production had `feeds.total=0`, `active=0`, and empty drilldown rows, so the feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` / `PENDING_NO_ELIGIBLE_TARGET` until a real eligible feed/actionRef exists. MS-026B adds risk-tiered operator automation: `npm run ops:production:retest:redacted`, `npm run ops:production:acceptance:redacted`, `npm run ops:feed-recheck:eligibility:redacted`, frontend recreate apply gating through `npm run ops:compose:recreate -- --apply`, backend API/worker recreate dry-run/apply guidance through `npm run ops:production:recreate:api-worker -- --dry-run` and `-- --apply`, and `npm run verify:operator-automation`. Codex did not mutate production, perform a credentialed production login, create feeds, seed data, or read real secrets.

MS-026C adds `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED`: `npm run ops:production:retest` is the one-command dry-run/retest/apply wrapper, `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED` replaces credential-free false failures, and `npm run ops:browser-evidence:verify` validates redacted browser evidence from the authenticated Operations Drilldown UI. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` until a real eligible feed exists and an operator-provided redacted receipt verifies `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`.

MS-020D adds the local-only production activation readiness package. It includes a public-data classification for the current status-only fields, an operator authority record template, a future post-deploy evidence checklist, and `npm run verify:production-readiness`. It does not authorize production mutation.

MS-021A adds a frontend-only fail-closed protected admin/business shell foundation and `npm run verify:auth-boundary`. It does not implement real auth/session, business admin features, backend routes, or production activation.

MS-021B adds a same-origin `GET /admin-auth/session` not_configured sentinel, a fail-closed auth-status client, and `npm run test:auth-session-sentinel`.

MS-022A adds disabled-by-default backend admin auth/session routes, same-origin browser login/session/logout integration, an exact auth proxy activated only by server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`, and local full-stack auth acceptance. The admin UI remains `NOT_DEPLOYED`; production activation, production secrets, CORS changes, edge mutation, tags, releases, and registry publication remain out of scope.

MS-022B adds the secretless production activation package for the still-not-deployed admin UI: backend admin auth hash/session-secret/config helpers, local production-mode RC acceptance with synthetic credentials, production activation package docs, operator handoff docs, and regression verifiers. It does not perform production deployment, production contact, registry publication, no Git tag, GitHub Release, PR, DNS/TLS/edge mutation, or real secret provisioning.

MS-023A-R2 promotes those safe repository-side pieces into an operator-managed production package while keeping `rss-admin-ui` `NOT_DEPLOYED`. Rollback baseline is operator-managed, server deployment/configuration is operator-managed, and Codex validation remains local-only with synthetic credentials. The package adds a secretless operator env template, a local operator-managed package verifier, and updated runbook guidance; it does not contact production, read real secrets, capture rollback baseline, deploy, restart, publish a registry image, tag, release, or create a PR.

MS-023B remediates the operator-reported `/status-api/health/ready` public-edge blocker as a repository package. MS-023C remediates the next operator-reported blocker: `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://127.0.0.1:3200` inside the admin UI production Docker bridge container is a container-loopback upstream misconfiguration. The admin UI upstream contract now rejects public Habersoft edge origins and Docker bridge loopback/unspecified origins, documents backend-network service DNS as the preferred production mode, keeps host-gateway mode conditional on container-side reachability proof, adds `npm run test:status-api-production-networking`, and keeps `npm run verify:production-upstream-contract`.

MS-023D records operator-reported plus Codex public read-only verification that `https://rss-panel.habersoft.com/healthz`, `/status-api/health/live`, and `/status-api/health/ready` are production-active for the read-only status dashboard transport. `/admin-auth/session` still returns HTTP `501` with `status=not_configured`, classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. That residual is not a blocker for read-only status-dashboard closure, but it blocks authenticated admin-shell production acceptance. The next operator action is backend runtime admin-auth env placement and `main-service-api` restart/recreate under the operator rollback plan, not continued changes to `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`.

MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR lands the admin-auth enablement package while preserving the MS-023D accepted status-dashboard result. MS-023D status-dashboard production transport remains accepted. MS-024A hardens same-origin `/status-api/*` and `/admin-auth/*` proxy routes so upstream CORS response headers are not surfaced to the browser, adds redacted operator auth smoke tooling, and improves backend admin-auth env-file validation with synthetic/local checks only. `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream; placing values only in `rss-admin-ui/.env.production` is insufficient because backend admin-auth values must be visible to the backend API service runtime. The remaining operator action is backend runtime admin-auth env placement and `main-service-api` restart/recreate under the operator rollback plan.

MS-024B_OPERATOR_ERGONOMICS_AUTH_SMOKE_REMEDIATION_READY_OPERATOR_RETEST_REQUIRED applies graduated guardrails after the operator-reported `admin-auth-smoke: fetch failed`, missing `RSS_ADMIN_UI_IMAGE` Compose interpolation blocker, and frontend restart-loop blocker. Frontend production Compose now supports harmless inspection without an env file by using `habersoft-rss-frontend:latest` as an operator-managed mutable local image default, while release verification still recommends an immutable image identity. Missing, invalid, public-edge, or container-loopback upstream origins no longer crash-loop the static admin UI; `/healthz` stays available and exact proxy routes return bounded JSON such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. MS-024B made no live auth-shell acceptance claim; MS-024F later closes that current-scope residual by operator report.

MS-024C_PRODUCTION_OVERLAY_CANONICALIZATION_READY_OPERATOR_RETEST_REQUIRED canonicalizes the frontend production runtime path after the operator found that plain `deploy/production/compose.yaml` can restart-loop when `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000` is used without the backend Docker network overlay. For production Docker bridge service-DNS upstreams, the canonical admin UI invocation is the helper path, which uses `deploy/production/compose.yaml` plus `deploy/production/compose.backend-network.yaml` when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured and blocks before recreate if a service-DNS upstream is configured without that network input. Plain frontend Compose remains valid for static inspection, config rendering with degraded/no-upstream defaults, and local/advanced scenarios that do not require backend service DNS. Runtime proxy generation now uses request-time upstream resolution so missing service DNS does not hide `/healthz`; exact proxy routes fail closed with bounded JSON. `AUTH_NOT_CONFIGURED_RESIDUAL` now points operators to backend runtime admin-auth env activation and redacted backend verifier steps, not frontend overlay trial-and-error.

MS-024D_BACKEND_ADMIN_AUTH_RUNTIME_ENV_WIRING_READY_OPERATOR_RETEST_REQUIRED lands backend production Compose wiring for the admin-auth runtime variables. The variables are mapped into `main-service-api` and intentionally omitted from `main-service-worker`; `--env-file` alone is not sufficient unless the service environment maps the names into the container. The new backend helpers `npm run production:admin-auth:diagnose:redacted -- --synthetic` and `npm run production:admin-auth:compose:verify` validate that path with redacted/synthetic data. Authenticated admin-shell production acceptance still requires an operator-owned backend env activation, `main-service-api` recreate, and redacted login/session/logout evidence.

MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING records operator-reported MS-024D retest evidence: backend admin-auth config is live and valid in `main-service-api`, worker admin-auth env remains absent by design, backend loopback `/admin-auth/session` returns configured unauthenticated, and the frontend edge recovered after `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`. `AUTH_CONFIGURED_UNAUTHENTICATED` is the expected pre-login state, not a backend env wiring failure. After any backend API/image/network/admin-auth env recreate, operators must recreate the frontend with `npm run ops:compose:recreate` so Nginx refreshes upstream/network references. MS-024E left authenticated admin-shell production acceptance as a residual until a later operator retest; MS-024F closes that residual for the current implemented auth shell scope.

MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED records the latest operator statement that, after MS-024E delivery, production retest was performed and the authenticated admin shell was accepted in production. The accepted current scope is `/healthz`, same-origin `/status-api/health/*`, same-origin `/admin-auth/*`, and protected shell entry/exit behavior as implemented so far. The acceptance is operator-reported; no durable redacted `AUTHENTICATED_ADMIN_ACCEPTED` smoke receipt was already present in Git, and Codex did not independently log in. auth-smoke:redacted remains a redacted regression/sanity tool, not a pending acceptance blocker for this closed scope. Safety boundary: no production mutation, no Codex credentialed login, no real secret access, no registry, no Git tag, no GitHub Release, and no PR. No further `AUTH_NOT_CONFIGURED_RESIDUAL` or `AUTH_CONFIGURED_UNAUTHENTICATED` operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.

MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED adds the first authenticated read-only admin business slice after the MS-024F shell acceptance: `GET /admin-api/operations/summary`, an Operations Overview panel, exact same-origin admin-api proxy routing, local full-stack synthetic acceptance, and `npm run verify:admin-operations-dashboard`. The route returns aggregate dependency, feed, entry, and ingestion counts only. It omits tenant identifiers, feed URLs, entry content, raw logs, upstream origins, cookies, secrets, Agent keys, Tenant tokens, and write controls. The admin session cookie is now scoped to `Path=/` so it authenticates both `/admin-auth/*` and `/admin-api/*`; login and logout clear the historical `Path=/admin-auth` cookie. At MS-025A time, production deployment and live retest of this new operations dashboard were operator-managed, and no MS-025A live production acceptance was claimed.

MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED remediates the operator-reported production blocker where `/admin-api/operations/summary` fell through to the SPA `index.html` because the running frontend image template did not insert the admin-api generated route block. The repository now includes `npm run test:admin-api-proxy-template`, which builds/runs the frontend image, inspects the effective generated Nginx config under `/tmp/nginx/conf.d/default.conf` and `nginx -T`, proves the route appears before the SPA fallback, proves `/admin-api` and `/admin-api/*` return JSON 404, and proves summary/unauth/unreachable cases return JSON rather than HTML. At R1 time, operator retest required rebuilding or updating the frontend image before `npm run ops:compose:recreate`; source pull alone was not sufficient for Nginx template or entrypoint changes. MS-025A-R2 records that the operator-reported retest residual is now closed.

MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED closes the MS-025A/R1 production residual from operator-reported live retest evidence. The read-only operations dashboard production acceptance is closed, the admin-api production proxy/template remediation is accepted, status dashboard production scope remains accepted, and authenticated admin shell production scope remains accepted. The reported safe classifications are `GET /healthz -> 200 OK`, `GET /status-api/health/live -> JSON 200`, `GET /status-api/health/ready -> JSON 200`, unauthenticated `GET /admin-api/operations/summary -> JSON 401`, unknown `GET /admin-api/foo -> JSON 404`, after browser sign-in the Operations Overview screen displayed successfully, after browser sign-in JSON aggregate summary data loaded successfully, `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`, and logout returned the UI to locked / unauthenticated state. `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails. Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load. Codex did not independently perform a credentialed production login, did not mutate production, did not read secrets, and did not accept write/business features. No current MS-025A/R1 operator retest residual remains.

## Root Docker Workflow

The root [`compose.yaml`](compose.yaml) owns local full-stack orchestration for PostgreSQL, Redis, backend API/worker, local JWKS fixture, and the admin UI.

Use non-secret local values:

```bash
POSTGRES_USER=main_service
POSTGRES_PASSWORD=main_service_local_password
POSTGRES_DB=main_service
DATABASE_URL=postgresql://main_service:main_service_local_password@postgres:5432/main_service?schema=public
docker compose config
```

Root Compose wires `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=http://main-service-api:3000` for local-only same-origin health rehearsal. The root admin UI port is `8081`, selected to avoid the backend API port (`3000` container, commonly `3200` on production loopback), PostgreSQL, Redis, and the existing auth admin UI port. No root Compose command deploys production.

## Documentation Map

- [Root production guide](PRODUCTION.md) - product-level deployment boundaries and migration status.
- [Codex workspace policy](CODEX_WORKSPACE_POLICY.md) - MS-020E E: workplace policy, cleanup contract, and future-agent guardrails.
- [Backend production guide](rss-habersoft-com/PRODUCTION.md) - backend canonical production operations and evidence history.
- [Admin UI production guide](rss-admin-ui/PRODUCTION.md) - frontend read-only status dashboard delivery contract.
- [Admin UI API/auth contract](rss-admin-ui/.docs/api-auth-contract.md) - deferred Tenant/admin authentication boundary.
- [Admin UI admin auth/session boundary](rss-admin-ui/.docs/admin-auth-session-boundary.md) - MS-021A protected shell and real-auth blocker contract.
- [Admin UI admin session static fallback](rss-admin-ui/.docs/admin-session-sentinel.md) - MS-021B/MS-022A same-origin not_configured fallback contract.
- [Admin UI production activation readiness](rss-admin-ui/.docs/production-activation-readiness.md) - MS-020D no-deploy activation readiness contract and local verifier.
- [Admin UI production activation package](rss-admin-ui/.docs/production-activation-package.md) - operator-managed, secretless production package, local RC acceptance, MS-023D status transport closure, and MS-024A auth enablement package.
- [Admin UI live status dashboard acceptance](rss-admin-ui/.docs/live-status-dashboard-acceptance.md) - MS-023D production read-only status transport acceptance, MS-024E `AUTH_CONFIGURED_UNAUTHENTICATED` evidence intake, and MS-024F operator-reported authenticated shell acceptance.
- [Admin UI operations dashboard contract](rss-admin-ui/.docs/admin-operations-dashboard.md) - MS-025A protected read-only operations overview, MS-025B drilldown, MS-026A bounded feed recheck action, same-origin admin-api proxy contract, and accepted read-only production evidence boundaries.
- [Admin UI operator risk model and evidence bridge](rss-admin-ui/.docs/operator-risk-model.md) - MS-026C one-command automation, browser evidence schema, risk tiers, and feed-recheck closure flow.
- [Admin UI status-api upstream remediation](rss-admin-ui/.docs/status-api-upstream-remediation.md) - MS-023C blocker runbook, MS-023D accepted status-api result, production networking contract, and local networking harness.
- [Admin UI production operator handoff](rss-admin-ui/.docs/admin-auth-production-operator-handoff.md) - Future operator authority, redacted evidence, and rollback checklist.
- [Backend admin auth production activation](rss-habersoft-com/.docs/admin-auth-production-activation.md) - Admin auth env variables and secretless provisioning helper contract.
- [Backend admin operations summary API](rss-habersoft-com/.docs/admin-operations-summary-api.md) - protected `GET /admin-api/operations/summary` aggregate data contract.
- [Admin UI read-only dashboard contract](rss-admin-ui/.docs/read-only-status-dashboard.md) - read-only dashboard behavior.
- [Admin UI same-origin health transport](rss-admin-ui/.docs/same-origin-health-transport.md) - MS-020C health transport contract and local rehearsal.
- [Backend detailed docs](rss-habersoft-com/.docs/README.md) - backend service and evidence documentation.

## Production Evidence Status

The backend production evidence series remains closed and is not reopened by this topology milestone:

| Milestone | Result |
|---|---|
| MS-018C | `PASSED` |
| MS-019B | `PARTIAL_ACCEPTED` |
| MS-019C | `PRODUCTION_BACKUP_RESTORE_VERIFIED` |
| MS-019D | `PARTIAL_ACCEPTED` |
| MS-019E | `SUCCESS` |
| MS-019F | `SUCCESS_GOVERNANCE_ACCEPTED` |

MS-020C adds a local/tested same-origin health transport contract and local full-stack rehearsal for the read-only admin status dashboard. MS-020D packages the production activation readiness contract and local verifier. MS-021A adds the protected admin shell safety boundary. MS-021B adds a same-origin auth-status sentinel only. MS-022A adds the local admin auth/session foundation and exact same-origin proxy activation, still with no production deployment. MS-022B prepares the secretless production activation package and local production-mode RC harness while keeping the admin UI `NOT_DEPLOYED`. MS-023A-R2 prepares the operator-managed production package and runbook updates while still keeping the admin UI `NOT_DEPLOYED`. MS-023B prepares the public-edge upstream remediation package. MS-023C prepares the production Docker bridge networking remediation package while requiring an operator-managed backend-network or proven host-gateway fix before live status-api acceptance. MS-023D accepts the read-only status-dashboard production transport from operator-reported and public read-only verified evidence, while historically classifying `/admin-auth/session -> 501 not_configured` as `AUTH_NOT_CONFIGURED_RESIDUAL`. MS-024A prepares the auth enablement package, CORS-header stripping proxy hardening, redacted auth smoke tool, and backend env-file validation while authenticated admin activation remained pending operator backend runtime changes. MS-024E records operator-reported configured unauthenticated auth-session evidence. MS-024F closes the current authenticated admin shell acceptance residual from operator-reported retest evidence only. MS-025A locally accepts the protected read-only operations summary package, MS-025A-R1 remediates the admin-api proxy template fallback, MS-025A-R2 closes the read-only operations dashboard production acceptance by operator report, and MS-026A lands only a bounded feed recheck action for operator-managed deploy/retest. These milestones do not deploy, restart, pull on, publish an image to, create a Git tag for, mutate production, perform Codex credentialed login, or capture rollback baseline on behalf of the operator.

## No-Secret Policy

Tracked files must not contain production credentials, database URLs with real passwords, Agent keys, JWTs, private keys, raw production evidence bodies, or private host credentials. External operator evidence lives under ignored `operator-state/`; central markdown docs may live under ignored `.md/`.

## Path Conventions

Repository commands should use relative paths. The former local Windows checkout example `C:\Users\EVO-MRDM\Desktop\habersoft-rss` is historical/legacy/do-not-use for new Codex temporary workspaces, clones, worktrees, test folders, build outputs, package outputs, or task caches. Active Codex task artifacts must be placed under `E:\Codex\rss-habersoft-com\workplace\`.
