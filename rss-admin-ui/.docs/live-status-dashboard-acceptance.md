# Live Status Dashboard Acceptance

Status: `MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`.

MS-023D closes the read-only status-dashboard production acceptance boundary for the already operator-managed admin UI surface. The accepted scope is limited to the production shell health endpoint and same-origin status-api transport:

```text
GET /healthz
GET /status-api/health/live
GET /status-api/health/ready
```

MS-024F records authenticated admin shell acceptance for the current implemented status/auth shell scope by operator report. MS-025A adds the first protected read-only admin operations dashboard locally, but live production acceptance for `/admin-api/operations/summary` remains pending operator deploy/retest. Business admin write pages, feed/user/tenant management, backend writes, monitoring/SLA claims, privileged production evidence projection, and future write-capable admin product slices remain out of scope.

Codex did not mutate production for MS-023D. Codex did not SSH/SCP/SFTP/rsync, restart services, run production Docker commands, edit production env files, capture rollback baseline, publish an image, create a registry tag, create a Git tag, create a GitHub Release, create a PR, or read production secrets.

MS-023D status-dashboard production transport remains accepted. MS-024E adds operator-reported evidence that backend admin auth is configured and the frontend edge returns `AUTH_CONFIGURED_UNAUTHENTICATED` after `npm run ops:compose:recreate`. MS-024F adds the operator-reported statement that authenticated admin shell production acceptance is closed for the current implemented scope. MS-025A-R2 adds operator-reported evidence that the read-only operations dashboard production acceptance is closed. Codex did not independently perform a credentialed login, mutate production, or capture rollback baseline.

## Evidence Boundary

Evidence source: `operator_reported` plus `codex_public_readonly_verified`.

The operator reported and Codex independently verified with public read-only GET requests, no cookies, no auth headers, and a bounded timeout:

| Path | Accepted status | Safe response summary |
|---|---:|---|
| `https://rss-panel.habersoft.com/healthz` | `200` | `ok` |
| `https://rss-panel.habersoft.com/status-api/health/live` | `200` | `status=live` |
| `https://rss-panel.habersoft.com/status-api/health/ready` | `200` | `status=ready`, `postgres=up`, `redis=up`, `tenantAuth=up` |
| `https://rss-panel.habersoft.com/admin-auth/session` | `501` | `configured=false`, `authenticated=false`, `status=not_configured`, `reason=not_configured` |

The `501 not_configured` admin-auth result was classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. It is not a blocker for the read-only status-dashboard closure because the status dashboard transport uses only `/status-api/health/live` and `/status-api/health/ready` without credentials. It was the authenticated admin-shell production acceptance residual later resolved through MS-024E configured-auth evidence and MS-024F operator-reported acceptance.

MS-024E operator-reported update:

| Path | Reported status | Safe response summary |
|---|---:|---|
| `https://rss-panel.habersoft.com/healthz` | `200` | `ok` |
| `https://rss-panel.habersoft.com/status-api/health/live` | `200` | `status=live` |
| `https://rss-panel.habersoft.com/status-api/health/ready` | `200` | `status=ready`, `postgres=up`, `redis=up`, `tenantAuth=up` |
| `https://rss-panel.habersoft.com/admin-auth/session` | `200` | `configured=true`, `authenticated=false`, `reason=unauthenticated` |

The frontend proxy recovered after canonical overlay helper recreate (`npm run ops:compose:recreate`) following the backend recreate.

The updated auth result was `AUTH_CONFIGURED_UNAUTHENTICATED`. It means the backend admin-auth env is wired and the frontend proxy is reaching it before login.

MS-024F operator-reported update:

- bounded status: `MS-024F_ADMIN_UI_PRODUCTION_ACTIVE_STATUS_AND_AUTH_SHELL_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- operator statement: after MS-024E delivery, production retest was performed and the authenticated admin shell was accepted in production;
- accepted scope: `/healthz`, same-origin `/status-api/health/*`, same-origin `/admin-auth/*`, and protected shell entry/exit behavior as currently implemented;
- source boundary: Codex did not independently perform a credentialed login, did not read real credentials, did not run real credentialed smoke, and did not mutate production;
- future business/admin write features are not accepted.

MS-025A repository-local update:

- bounded status: `MS-025A_AUTHENTICATED_READ_ONLY_ADMIN_OPERATIONS_DASHBOARD_LOCAL_ACCEPTED_OPERATOR_DEPLOY_RETEST_REQUIRED`;
- new protected route: `GET /admin-api/operations/summary`;
- local contract: aggregate dependency, feed, entry, and ingestion counts only;
- no production deployment, no Codex credentialed login, no production mutation, and no live route acceptance claim;
- next operator action for this new slice: deploy/recreate under the backend/frontend runbooks, run `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`, then retest login, `/admin-api/operations/summary`, Operations Overview rendering, logout, and locked-after-logout behavior.

MS-025A-R1 proxy-template remediation:

- bounded status: `MS-025A_R1_ADMIN_API_PROXY_TEMPLATE_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED`;
- operator-reported blocker: the production edge returned SPA HTML for `/admin-api/operations/summary`, meaning the running frontend image/effective Nginx config did not serve the generated admin-api route block;
- repository proof: `npm run test:admin-api-proxy-template` verifies `/tmp/nginx/conf.d/default.conf`, `nginx -T`, exact route ordering before `location /`, JSON 401/404/405/501/502 admin-api responses, and no unresolved `__ADMIN_UI_*__` markers;
- next operator action for this remediation: rebuild or update the configured frontend image, rerun `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`, verify the generated config inside the running container, then retest login, `/admin-api/operations/summary`, Operations Overview rendering, logout, and locked-after-logout behavior.

MS-025A-R2 operations-dashboard acceptance:

- bounded status: `MS-025A-R2_ADMIN_OPERATIONS_DASHBOARD_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`;
- source type: `operator_reported`;
- operator-reported evidence: `GET /healthz -> 200 OK`, `GET /status-api/health/live -> JSON 200`, `GET /status-api/health/ready -> JSON 200`, unauthenticated `GET /admin-api/operations/summary -> JSON 401`, unknown `GET /admin-api/foo -> JSON 404`, after browser sign-in, the Operations Overview screen displayed successfully, after browser sign-in, JSON aggregate summary data loaded successfully, `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED`, and logout returned the UI to locked / unauthenticated state;
- meaning: read-only operations dashboard production acceptance is closed, admin-api production proxy/template remediation is accepted, status dashboard production scope remains accepted, authenticated admin shell production scope remains accepted, and No current MS-025A/R1 operator retest residual remains;
- boundary: Codex did not independently perform a credentialed production login, did not mutate production, did not read real credentials, and did not accept write/business features.

## Runtime Ownership Split

Frontend/admin UI runtime env controls:

```text
RSS_ADMIN_UI_IMAGE
ADMIN_UI_HOST_PORT
ADMIN_UI_BACKEND_DOCKER_NETWORK
ADMIN_UI_HEALTH_UPSTREAM_ORIGIN
ADMIN_UI_AUTH_UPSTREAM_ORIGIN
ADMIN_UI_ENVIRONMENT_NAME
```

Those variables render the static runtime, `/healthz`, exact `/status-api/*` proxy routes, and exact `/admin-auth/*` proxy routes.

Backend admin-auth runtime env controls:

```text
ADMIN_UI_AUTH_MODE
ADMIN_UI_ADMIN_USERNAME
ADMIN_UI_ADMIN_PASSWORD_HASH
ADMIN_UI_SESSION_SECRET
ADMIN_UI_SESSION_TTL_SECONDS
ADMIN_UI_SESSION_COOKIE_NAME
ADMIN_UI_SESSION_COOKIE_SECURE
ADMIN_UI_SESSION_REDIS_PREFIX
```

Those variables must be visible to the backend API runtime that serves `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`. Passing backend-only auth variables only to the frontend/admin UI Compose command does not enable backend auth.

MS-025A also requires that same backend API runtime to serve `GET /admin-api/operations/summary`. The frontend proxy reuses `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` for the admin-api route, so after backend API/image/network/admin-auth env recreate the frontend image rebuild/update and helper recreate remain required before edge retest when Nginx template or entrypoint source changed.

## Auth Evidence Progression

Because the MS-023D public status-api checks pass, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` to remediate auth states.

MS-024C clarifies the remaining production retest flow: use the frontend helper path with the backend-network overlay for service-DNS upstreams, then treat persistent `AUTH_NOT_CONFIGURED_RESIDUAL` as backend runtime admin-auth env activation. The redacted residual classes are backend auth mode disabled/missing, backend admin username missing/placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured.

Next operator action if `/admin-auth/session -> 501 not_configured` regresses:

1. Verify `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` remains an internal backend origin reachable from the admin UI runtime.
2. Verify the backend API runtime receives the backend admin-auth env values from `deploy/production/backend-admin-auth.env.template`.
3. Restart/recreate only the backend API runtime under the operator rollback plan after env placement is corrected.
4. Recreate the frontend with `cd /opt/habersoft-rss/rss-admin-ui && npm run ops:compose:recreate`.
5. Re-run redacted auth smoke evidence without pasting real admin credentials, password hashes, session secrets, cookies, logs, or raw response bodies into chat, Git, docs, or receipts. Do not paste real admin credentials into chat, Git, docs, receipts, or issue comments.

MS-024A clarification: `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient because those backend auth variables must be present in the backend API service runtime. Validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled`, then perform backend API restart/recreate only as an operator action under the rollback plan.

Expected authenticated-admin progression after configured unauthenticated evidence:

```text
GET /admin-auth/session without a valid cookie -> HTTP 200, configured=true, authenticated=false
POST /admin-auth/login with valid operator-owned credential -> HTTP 200, HttpOnly SameSite=Lax Secure cookie
GET /admin-auth/session with the valid cookie -> HTTP 200, authenticated=true
GET /admin-api/operations/summary with the valid cookie -> HTTP 200, aggregate-only status ok
POST /admin-auth/logout -> HTTP 200, server-side session invalidated
GET /admin-api/operations/summary after logout -> HTTP 401, no operations metrics
```

The admin-api steps were new in MS-025A and were not production accepted by MS-023D, MS-024E, or MS-024F. MS-024F records only the operator-reported acceptance of the status/auth shell scope implemented at that time. MS-025A-R2 records the read-only operations dashboard production acceptance by operator report.

Before the edge retest, verify the effective generated config in the running frontend container. The path under `/tmp` is authoritative for the generated runtime config; `/etc/nginx/conf.d/default.conf` may remain the stock image path and is not sufficient evidence for this blocker:

```bash
docker compose \
  --env-file .env.production \
  -f deploy/production/compose.yaml \
  -f deploy/production/compose.backend-network.yaml \
  exec rss-admin-ui sh -lc 'nginx -T 2>&1 | grep -F "/admin-api/operations/summary" && ! grep -F "__ADMIN_UI_" /tmp/nginx/conf.d/default.conf'
```

The redacted smoke helper is now a regression/sanity tool, not a pending acceptance blocker for the current implemented scope: `npm run auth-smoke:redacted`; credentials must be supplied only through `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD`. For MS-025A-R2, `AUTH_CONFIGURED_UNAUTHENTICATED` without credentials is an observation/sanity result, not a pending blocker; Full authenticated acceptance for MS-025A-R2 is operator-reported from browser login plus operations dashboard load; `AUTH_LOGIN_ATTEMPT_FAILED` remains a blocker when credentials are supplied and login fails; future regression tests may still use credentialed smoke, but credentials must be environment variables only and must not be logged. Local synthetic coverage is `npm run test:admin-auth-smoke-redacted`, package coverage is `npm run verify:ms024a-auth-enablement-package`, auth-shell claim-boundary coverage is `npm run verify:production-auth-acceptance`, and operations closeout coverage is `npm run verify:production-operations-acceptance`. No further AUTH_NOT_CONFIGURED_RESIDUAL or AUTH_CONFIGURED_UNAUTHENTICATED operator action remains for the current implemented admin-auth shell scope unless new contradictory evidence appears.
