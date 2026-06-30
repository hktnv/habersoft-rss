# Live Status Dashboard Acceptance

Status: `MS-024A_ADMIN_AUTH_ENABLEMENT_PACKAGE_READY_STATUS_DASHBOARD_ACTIVE_AUTH_ACTIVATION_PENDING_OPERATOR`.

MS-023D closes the read-only status-dashboard production acceptance boundary for the already operator-managed admin UI surface. The accepted scope is limited to the production shell health endpoint and same-origin status-api transport:

```text
GET /healthz
GET /status-api/health/live
GET /status-api/health/ready
```

This is not authenticated admin product acceptance. Login, session-authenticated dashboard visibility, logout, business admin pages, feed/user/tenant management, backend writes, monitoring/SLA claims, and privileged production evidence projection remain out of scope.

Codex did not mutate production for MS-023D. Codex did not SSH/SCP/SFTP/rsync, restart services, run production Docker commands, edit production env files, capture rollback baseline, publish an image, create a registry tag, create a Git tag, create a GitHub Release, create a PR, or read production secrets.

MS-023D status-dashboard production transport remains accepted in MS-024A. MS-024A adds the auth enablement package only: proxy CORS-header stripping, redacted auth smoke tooling, and backend admin-auth env-file validation. It does not accept authenticated admin-shell production, and it does not perform production deployment or rollback-baseline capture.

## Evidence Boundary

Evidence source: `operator_reported` plus `codex_public_readonly_verified`.

The operator reported and Codex independently verified with public read-only GET requests, no cookies, no auth headers, and a bounded timeout:

| Path | Accepted status | Safe response summary |
|---|---:|---|
| `https://rss-panel.habersoft.com/healthz` | `200` | `ok` |
| `https://rss-panel.habersoft.com/status-api/health/live` | `200` | `status=live` |
| `https://rss-panel.habersoft.com/status-api/health/ready` | `200` | `status=ready`, `postgres=up`, `redis=up`, `tenantAuth=up` |
| `https://rss-panel.habersoft.com/admin-auth/session` | `501` | `configured=false`, `authenticated=false`, `status=not_configured`, `reason=not_configured` |

The `501 not_configured` admin-auth result is classified as `AUTH_NOT_CONFIGURED_RESIDUAL`. It is not a blocker for the read-only status-dashboard closure because the status dashboard transport uses only `/status-api/health/live` and `/status-api/health/ready` without credentials. It is a blocker for authenticated admin-shell production acceptance.

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

## Residual Remediation

Because the MS-023D public status-api checks pass, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN` to remediate `AUTH_NOT_CONFIGURED_RESIDUAL`.

MS-024C clarifies the remaining production retest flow: use the frontend helper path with the backend-network overlay for service-DNS upstreams, then treat persistent `AUTH_NOT_CONFIGURED_RESIDUAL` as backend runtime admin-auth env activation. The redacted residual classes are backend auth mode disabled/missing, backend admin username missing/placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured.

Next operator action for `/admin-auth/session -> 501 not_configured`:

1. Verify `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` remains an internal backend origin reachable from the admin UI runtime.
2. Verify the backend API runtime receives the backend admin-auth env values from `deploy/production/backend-admin-auth.env.template`.
3. Restart/recreate only the backend API runtime under the operator rollback plan after env placement is corrected.
4. Re-run redacted auth smoke evidence without pasting real admin credentials, password hashes, session secrets, cookies, logs, or raw response bodies into chat, Git, docs, or receipts. Do not paste real admin credentials into chat, Git, docs, receipts, or issue comments.

MS-024A clarification: `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient because those backend auth variables must be present in the backend API service runtime. Validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled`, then perform backend API restart/recreate only as an operator action under the rollback plan.

Expected authenticated-admin progression after backend auth activation:

```text
GET /admin-auth/session without a valid cookie -> HTTP 200, configured=true, authenticated=false
POST /admin-auth/login with valid operator-owned credential -> HTTP 200, HttpOnly SameSite=Lax Secure cookie
GET /admin-auth/session with the valid cookie -> HTTP 200, authenticated=true
POST /admin-auth/logout -> HTTP 200, server-side session invalidated
```

That progression is not accepted by MS-023D and requires a separate operator-authorized evidence milestone.

The redacted smoke helper for that later evidence is `npm run auth-smoke:redacted`; local synthetic coverage is `npm run test:admin-auth-smoke-redacted` and package coverage is `npm run verify:ms024a-auth-enablement-package`.
