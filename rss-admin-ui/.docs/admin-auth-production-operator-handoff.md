# Admin Auth Production Operator Handoff

Status: `MS-023D_STATUS_DASHBOARD_PRODUCTION_ACTIVE_AUTH_NOT_CONFIGURED`.

This handoff is for the remaining operator-authorized authenticated admin activation milestone. MS-023D accepts only the read-only status-dashboard production transport. It does not activate production admin auth, does not publish a registry image, does no production deployment, creates no Git tag, creates no GitHub Release, does not capture rollback baseline, and does not collect real production credentials.

## Authority Checklist

Before production activation, the operator must explicitly authorize:

- authenticated admin UI activation;
- immutable frontend image selection and registry/source availability;
- backend rollout plan if `ADMIN_UI_AUTH_MODE=single_admin` will be enabled in production;
- production secret provisioning outside Git;
- edge/TLS/OpenLiteSpeed/DNS changes;
- redacted evidence capture boundaries;
- rollback target and rollback authority.
- operator-managed rollback baseline capture before mutation.

Without that authority, authenticated admin-shell production acceptance remains blocked by `AUTH_NOT_CONFIGURED_RESIDUAL`.

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

MS-023D evidence already accepts `/healthz`, `/status-api/health/live`, and `/status-api/health/ready`. If `/admin-auth/session` returns HTTP `501 not_configured`, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Verify backend runtime admin-auth env placement from `deploy/production/backend-admin-auth.env.template`, then restart/recreate the backend API under the operator rollback plan.

Use backend helpers from `rss-habersoft-com`:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config
```

The helpers redact generated values by default. Use sensitive output only in a controlled operator terminal and move the value directly into the operator-owned secret store. Never commit real values.

## Activation Evidence Checklist

Future acceptance evidence should prove, with redaction:

- remote Git SHA and image identity;
- expected frontend and backend env variable names are present;
- secret values are redacted;
- `AUTH_NOT_CONFIGURED_RESIDUAL` is gone; `GET /admin-auth/session` without a valid cookie returns `configured=true`, `authenticated=false`, and HTTP `200`;
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

## Rollback Boundary

Rollback must be operator-controlled. It may disable `ADMIN_UI_AUTH_MODE`, remove the admin UI edge route, or roll back to a previous immutable image, depending on the authorized production plan. MS-022B does not execute rollback and does not mutate production.

MS-023D keeps rollback-baseline capture operator-managed. Codex does not capture, infer, or assert a production rollback baseline in this package milestone.

## Residuals

Business admin features, feed/user/tenant management UI, Agent operations, and any browser use of Tenant/admin write APIs remain out of scope. The same-origin transport model remains the production activation model; CORS broadening is not part of this package.
