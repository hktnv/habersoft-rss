# Admin Auth Production Operator Handoff

Status: `MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`.

This handoff records the accepted current admin auth shell boundary and keeps the operator guardrails for future changes. MS-023D accepts the read-only status-dashboard production transport, and MS-023D status-dashboard production transport remains accepted. MS-024B is repository remediation for the operator-reported latest recreate/auth-smoke blocker. MS-024C removes overlay trial-and-error by making the helper path canonical for service-DNS upstreams and by keeping `/healthz` available if service DNS is unresolved at runtime. MS-024D lands backend production Compose env wiring for `main-service-api` and redacted/synthetic verification helpers. MS-024E records operator-reported evidence that backend admin auth is configured and the frontend edge returns `AUTH_CONFIGURED_UNAUTHENTICATED` after `npm run ops:compose:recreate`. MS-024F records the operator-reported production retest statement that authenticated admin shell production acceptance is closed for the current implemented scope. MS-025A-R2 records operator-reported production acceptance for the read-only operations summary dashboard and R1 admin-api proxy-template remediation. MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED adds local read-only Operations Drilldown at `GET /admin-api/operations/drilldown`; drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence. MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED adds local bounded feed recheck action support at `POST /admin-api/operations/feed-recheck-requests`. Codex did not independently perform a credentialed login, did not publish a registry image, did no production deployment, created no Git tag, created no GitHub Release, created no PR, did not capture rollback baseline, and did not collect real production credentials. No production deployment was performed by Codex for MS-026A.

## Future Change Authority Checklist

Before future production auth/runtime changes, the operator must explicitly authorize:

- authenticated admin UI activation;
- immutable frontend image selection and registry/source availability;
- backend rollout plan if `ADMIN_UI_AUTH_MODE=single_admin` will be enabled in production;
- production secret provisioning outside Git;
- edge/TLS/OpenLiteSpeed/DNS changes;
- redacted evidence capture boundaries;
- rollback target and rollback authority.
- operator-managed rollback baseline capture before mutation.

MS-024F closes the current implemented authenticated admin-shell acceptance residual by operator report. MS-025A-R2 remains accepted for the existing read-only operations summary dashboard. MS-025B-R1 drilldown production acceptance is closed by operator report. MS-026A feed recheck action remains operator deploy/retest required. Without fresh authority, do not expand any acceptance to broader future business/admin write features, feed editing, tenant management, role/permission expansion, or new production mutation.

## Secret Handling Checklist

Provision these values outside Git and outside shell history where possible:

```text
ADMIN_UI_AUTH_MODE=single_admin
ADMIN_UI_ADMIN_USERNAME=<ADMIN_USERNAME>
ADMIN_UI_ADMIN_PASSWORD_HASH=<ADMIN_PASSWORD_HASH>
ADMIN_UI_SESSION_SECRET=<ADMIN_SESSION_SECRET>
ADMIN_UI_SESSION_TTL_SECONDS=3600
ADMIN_UI_SESSION_COOKIE_NAME=habersoft_admin_session
ADMIN_UI_SESSION_COOKIE_SECURE=true
ADMIN_UI_SESSION_REDIS_PREFIX=admin_auth:production
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=<INTERNAL_BACKEND_ORIGIN_REACHABLE_FROM_ADMIN_UI_RUNTIME>
ADMIN_UI_AUTH_UPSTREAM_ORIGIN=<INTERNAL_BACKEND_ORIGIN_REACHABLE_FROM_ADMIN_UI_RUNTIME>
ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>
```

`ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`, `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`, `ADMIN_UI_BACKEND_DOCKER_NETWORK`, `RSS_ADMIN_UI_IMAGE`, `ADMIN_UI_HOST_PORT`, and `ADMIN_UI_ENVIRONMENT_NAME` belong to the frontend/admin UI runtime. `ADMIN_UI_AUTH_MODE`, `ADMIN_UI_ADMIN_USERNAME`, `ADMIN_UI_ADMIN_PASSWORD_HASH`, `ADMIN_UI_SESSION_SECRET`, and session cookie/Redis controls belong to the backend API runtime. Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth.

Do not set either upstream to public edge origins such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. In the admin UI production Docker bridge package, do not set either upstream to `127.0.0.1`, `localhost`, `::1`, `[::1]`, or `0.0.0.0`; that is a container-loopback upstream misconfiguration. Prefer backend-network service DNS with `ADMIN_UI_BACKEND_DOCKER_NETWORK=<backend_docker_network_name>` and `http://<backend_service_or_alias>:3000`, for example `http://main-service-api:3000`. Use `http://host.docker.internal:3200` only after an operator-run container-side reachability check proves host-gateway access.

MS-024B graduated guardrails mean these bad upstream values should not crash-loop the static frontend anymore. `/healthz` remains available, while exact proxy routes return bounded JSON reasons such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. Unsafe upstream traffic still does not proxy successfully.

MS-024C helper guardrails mean backend service DNS such as `http://main-service-api:3000` requires the backend-network overlay. Use `npm run ops:compose:config` and `npm run ops:compose:recreate`; do not rely on plain `deploy/production/compose.yaml` for a production bridge runtime using service DNS. The helper includes `compose.backend-network.yaml` when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is set and blocks before recreate when service DNS is configured without that network value.

MS-023D evidence already accepts `/healthz`, `/status-api/health/live`, and `/status-api/health/ready`. If `/admin-auth/session` returns HTTP `501 not_configured`, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Verify backend runtime admin-auth env placement from `deploy/production/backend-admin-auth.env.template`, then restart/recreate the backend API under the operator rollback plan.

MS-024E clarification: `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. `/admin-auth/session -> configured=true, authenticated=false, reason=unauthenticated` means backend auth is configured before login. MS-024F records that a later operator production retest accepted the authenticated admin shell for the current implemented scope. Placing values only in `rss-admin-ui/.env.production` is insufficient; backend-only auth variables must be applied to the backend API service runtime. Production Compose maps those variables into `main-service-api` and intentionally omits them from `main-service-worker`. Validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled` before backend API restart/recreate.

After backend API/image/network/admin-auth env recreate, run the frontend helper before edge auth evidence and before testing `/admin-api/operations/drilldown`:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
```

This refreshes frontend Nginx upstream/network references. Otherwise status/auth proxy routes can return `502` or `auth_unavailable` even while backend loopback auth is configured.

Use backend helpers from `rss-habersoft-com`:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config
npm run production:admin-auth:diagnose:redacted -- --synthetic
npm run production:admin-auth:compose:verify
```

The helpers redact generated values by default. Use sensitive output only in a controlled operator terminal and move the value directly into the operator-owned secret store. Never commit real values.

Use the redacted frontend smoke helper as a regression/sanity tool after backend env placement or future changes:

```bash
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
ADMIN_AUTH_SMOKE_USERNAME=<operator-owned-username> ADMIN_AUTH_SMOKE_PASSWORD=<operator-owned-password> npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Do not paste real admin credentials, cookies, password hashes, session secrets, Redis keys, raw logs, or raw production response bodies into chat, Git, docs, or receipts. MS-024E auth-smoke classifies `AUTH_NOT_CONFIGURED_RESIDUAL`, `AUTH_CONFIGURED_UNAUTHENTICATED`, `AUTH_LOGIN_ATTEMPT_FAILED`, `AUTHENTICATED_ADMIN_ACCEPTED`, and `STATUS_API_ROUTE_UNAVAILABLE` with redacted next steps. If credentials are absent, `AUTH_CONFIGURED_UNAUTHENTICATED` is expected and reports `login_smoke_pending`; for MS-025A-R2, `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker. If credentials are present, the report states `login_attempted` without printing values, and `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails. Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load. Future regression tests may still use credentialed smoke, but credentials must be environment variables only and must not be logged. MS-024F makes this helper a redacted regression/sanity tool, not a pending acceptance blocker for the current implemented scope. MS-024A/MS-024B/MS-024C/MS-024E/MS-024F/MS-025A-R2 validation commands are `npm run test:admin-auth-smoke-redacted`, `npm run verify:ms024a-auth-enablement-package`, `npm run verify:operator-ergonomics`, `npm run verify:production-overlay-canonicalization`, `npm run verify:production-auth-acceptance`, and `npm run verify:production-operations-acceptance`. No CORS broadening is part of the activation package.

## MS-024C operator retest checklist

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
ADMIN_AUTH_SMOKE_USERNAME="<redacted>" ADMIN_AUTH_SMOKE_PASSWORD="<redacted>" npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Advanced direct Compose fallback:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  up -d --no-build --pull never --force-recreate rss-admin-ui
```

This checklist made no live acceptance claim for authenticated admin shell at MS-024C/MS-024E time. MS-024F now records operator-reported authenticated admin shell acceptance for the current implemented scope.

## Regression Evidence Checklist

Future regression evidence should prove, with redaction:

- remote Git SHA and image identity;
- expected frontend and backend env variable names are present;
- secret values are redacted;
- `AUTH_NOT_CONFIGURED_RESIDUAL` is gone; `GET /admin-auth/session` without a valid cookie returns `configured=true`, `authenticated=false`, and HTTP `200` (`AUTH_CONFIGURED_UNAUTHENTICATED`);
- `GET /admin-auth/session` fails closed before login;
- invalid login is rejected;
- valid login creates an HttpOnly, `SameSite=Lax`, `Secure`, `/admin-auth` cookie;
- session after login returns safe authenticated state only;
- status dashboard health paths work through `/status-api/health/live` and `/status-api/health/ready`;
- status-api upstream origin is backend-network service DNS or proven host-gateway, not public edge and not container loopback;
- protected shell is locked before login, unlocked after session, and locked after logout;
- logout invalidates the server-side Redis session;
- no Agent key, Tenant bearer token, JWT, password, password hash, session secret, raw Redis key, raw logs, or raw production response body is copied into Git;
- rollback path is available and does not require unsafe source edits.

No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.

MS-025A-R2 operations-dashboard closeout:

- bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- accepted scope: read-only operations dashboard production acceptance is closed, admin-api production proxy/template remediation is accepted, status dashboard production scope remains accepted, and authenticated admin shell production scope remains accepted;
- safety boundary: Codex did not independently perform a credentialed production login, did not mutate production, and did not accept write/business features;
- residual boundary: No current MS-025A/R1 operator retest residual remains.

MS-025B drilldown retest residual:

- bounded status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- route: `GET /admin-api/operations/drilldown`;
- safe fields: opaque `displayId`, safe `displayName`, public `sourceHost`, statuses, counts, timestamps, safe notes, `capabilities`, and `maxRows=20`;
- forbidden fields: raw feed URL paths or queries, entry content, raw logs, raw request/response bodies, private hostnames, cookies, password hashes, session secrets, database/Redis URLs, Agent key values, Tenant bearer tokens, JWT claims, `localStorage`, `sessionStorage`, `IndexedDB`, `cookieStore`, `document.cookie`, and write controls;
- MS-026A action fields: `POST /admin-api/operations/feed-recheck-requests`, `X-Admin-CSRF`, `X-Admin-Idempotency-Key`, explicit confirmation, opaque `actionRef`, 300 second cooldown, and existing due-feed path with no synchronous external feed fetch;
- operator retest hygiene: Do not paste credentials, cookies, sessions, CSRF tokens, idempotency keys, raw response bodies with sensitive values, raw feed URLs, raw logs, or secrets;
- next operator action: after pulling main and rebuilding/updating backend/frontend images as required, run backend recreate diagnostics with `npm run ops:production:recreate:api-worker -- --dry-run`, use `npm run ops:production:recreate:api-worker -- --apply` only for an operator-owned mutation, recreate the frontend with `npm run ops:compose:recreate -- --apply` when intended, then test `/healthz`, `/status-api/health/live`, `/status-api/health/ready`, unauthenticated drilldown JSON `401`, authenticated Operations Drilldown JSON/UI data, and logout returning to locked state.

MS-026B operator automation closeout:

- bounded status: `MS-026B_OPERATOR_REPORTED_FEED_RECHECK_ROUTE_DEPLOYED_NO_ELIGIBLE_TARGET`;
- production route smoke for MS-026A is operator-reported deployed, including summary/drilldown/feed-recheck exact routes, JSON 404/405/401 behavior, browser login, and Operations Overview/Drilldown load;
- feed recheck effect remains pending because production reported zero feeds and no actionRef: `NO_ELIGIBLE_FEED_RECHECK_TARGET`, `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET`, and `PENDING_NO_ELIGIBLE_TARGET`;
- no production feed may be created, seeded, or faked for evidence;
- preferred redacted commands are `npm run ops:production:retest:redacted`, `npm run ops:production:acceptance:redacted -- --endpoint https://rss-panel.habersoft.com`, `npm run ops:feed-recheck:eligibility:redacted -- --endpoint https://rss-panel.habersoft.com`, and `npm run verify:operator-automation`;
- risk model: CRITICAL boundaries always fail closed, HIGH blocks production apply, MEDIUM warns/degrades in local or diagnose mode, and LOW remains informational.

## Rollback Boundary

Rollback must be operator-controlled. It may disable `ADMIN_UI_AUTH_MODE`, remove the admin UI edge route, or roll back to a previous immutable image, depending on the authorized production plan. MS-022B does not execute rollback and does not mutate production.

MS-023D keeps rollback-baseline capture operator-managed. Codex does not capture, infer, or assert a production rollback baseline in this package milestone.

## Residuals

Business admin features, feed/user/tenant management UI, Agent operations, and any browser use of Tenant/admin write APIs remain out of scope. The same-origin transport model remains the production activation model; CORS broadening is not part of this package.

## MS-026C Operator Handoff

MS-026C lands `SUCCESS_MS_026C_ONE_COMMAND_OPERATOR_AUTOMATION_AND_FEED_RECHECK_CLOSURE_FLOW_LANDED_OPERATOR_RETEST_REQUIRED` without production mutation by Codex. Operators can use:

```bash
npm run ops:production:retest -- --dry-run
npm run ops:production:retest -- --retest-only --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:production:retest -- --apply --endpoint https://rss-panel.habersoft.com --nginx-config-file <operator-generated-nginx-conf>
npm run ops:browser-evidence:verify -- --file <redacted-browser-evidence.json>
npm run verify:browser-evidence
```

If environment credentials are absent, the scripts classify the remaining authenticated proof as `AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED`. The authenticated UI export and verifier use only redacted browser classes: `BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY`, `BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET`, and future `BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED`.

Do not paste secrets, cookies, sessions, CSRF tokens, idempotency keys, raw actionRefs, raw feed URLs, raw request/response bodies, private hostnames, raw logs, Agent keys, Tenant bearer/JWT values, browser storage values, or filesystem paths into receipts. Feed recheck effect remains `PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET` until a real eligible production feed exists and the operator exports a verifier-accepted redacted receipt after one explicit bounded recheck action.
