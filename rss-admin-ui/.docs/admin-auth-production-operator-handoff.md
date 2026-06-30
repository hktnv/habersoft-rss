# Admin Auth Production Operator Handoff

Status: `MS-024C_PRODUCTION_OVERLAY_CANONICALIZATION_READY_OPERATOR_RETEST_REQUIRED`.

This handoff is for the remaining operator-authorized authenticated admin activation milestone. MS-023D accepts only the read-only status-dashboard production transport, and MS-023D status-dashboard production transport remains accepted in MS-024A. MS-024B is repository remediation for the operator-reported latest recreate/auth-smoke blocker. MS-024C removes the remaining overlay trial-and-error by making the helper path canonical for service-DNS upstreams and by keeping `/healthz` available if service DNS is unresolved at runtime. It does not activate production admin auth, does not publish a registry image, does no production deployment, creates no Git tag, creates no GitHub Release, does not capture rollback baseline, and does not collect real production credentials.

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

MS-024B graduated guardrails mean these bad upstream values should not crash-loop the static frontend anymore. `/healthz` remains available, while exact proxy routes return bounded JSON reasons such as `invalid_upstream_origin`, `public_edge_upstream_rejected`, `upstream_unavailable`, or `upstream_forbidden`. Unsafe upstream traffic still does not proxy successfully.

MS-024C helper guardrails mean backend service DNS such as `http://main-service-api:3000` requires the backend-network overlay. Use `npm run ops:compose:config` and `npm run ops:compose:up -- --force-recreate rss-admin-ui`; do not rely on plain `deploy/production/compose.yaml` for a production bridge runtime using service DNS. The helper includes `compose.backend-network.yaml` when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is set and blocks before recreate when service DNS is configured without that network value.

MS-023D evidence already accepts `/healthz`, `/status-api/health/live`, and `/status-api/health/ready`. If `/admin-auth/session` returns HTTP `501 not_configured`, do not keep changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Verify backend runtime admin-auth env placement from `deploy/production/backend-admin-auth.env.template`, then restart/recreate the backend API under the operator rollback plan.

MS-024A clarification: `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. Placing values only in `rss-admin-ui/.env.production` is insufficient; backend-only auth variables must be applied to the backend API service runtime. Validate the backend env file with `npm run admin-auth:verify-config -- --env-file <path> --require-enabled` before backend API restart/recreate.

Use backend helpers from `rss-habersoft-com`:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config
```

The helpers redact generated values by default. Use sensitive output only in a controlled operator terminal and move the value directly into the operator-owned secret store. Never commit real values.

Use the redacted frontend smoke helper after backend env placement:

```bash
npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
ADMIN_AUTH_SMOKE_USERNAME=<operator-owned-username> ADMIN_AUTH_SMOKE_PASSWORD=<operator-owned-password> npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com
```

Do not paste real admin credentials, cookies, password hashes, session secrets, Redis keys, raw logs, or raw production response bodies into chat, Git, docs, or receipts. MS-024C auth-smoke classifies endpoint down, `/healthz` unavailable, status-api upstream unavailable/misconfigured, backend admin-auth env not loaded, auth upstream misconfigured, invalid credentials, missing cookie, post-login session failure, and logout failure with redacted next steps. `AUTH_NOT_CONFIGURED_RESIDUAL` maps to backend admin-auth mode disabled/missing, backend admin username missing/placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured. MS-024A/MS-024B/MS-024C validation commands are `npm run test:admin-auth-smoke-redacted`, `npm run verify:ms024a-auth-enablement-package`, `npm run verify:operator-ergonomics`, and `npm run verify:production-overlay-canonicalization`. No CORS broadening is part of the activation package.

## MS-024C operator retest checklist

```bash
git pull --ff-only origin main
cd /opt/habersoft-rss/rss-admin-ui
npm run production:diagnose:redacted
npm run ops:compose:config
npm run ops:compose:up -- --force-recreate rss-admin-ui
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

This checklist is no live acceptance claimed for authenticated admin shell. The authenticated admin shell remains pending until redacted login/session/logout smoke passes.

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
