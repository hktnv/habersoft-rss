# Admin Auth Production Operator Handoff

Status: `MS-023B_STATUS_API_UPSTREAM_REMEDIATION_PACKAGE_READY_OPERATOR_FIX_REQUIRED - NOT_DEPLOYED`.

This handoff is for a future operator-authorized production activation milestone. MS-023B does not deploy the admin UI, does not activate production admin auth, does not publish a registry image, does no production deployment, creates no Git tag, creates no GitHub Release, does not capture rollback baseline, and does not collect real production credentials.

## Authority Checklist

Before production activation, the operator must explicitly authorize:

- production admin UI deployment;
- immutable frontend image selection and registry/source availability;
- backend rollout plan if `ADMIN_UI_AUTH_MODE=single_admin` will be enabled in production;
- production secret provisioning outside Git;
- edge/TLS/OpenLiteSpeed/DNS changes;
- redacted evidence capture boundaries;
- rollback target and rollback authority.
- operator-managed rollback baseline capture before mutation.

Without that authority, `rss-admin-ui` remains `NOT_DEPLOYED`.

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
```

Do not set either upstream to public edge origins such as `https://rss.habersoft.com` or `https://rss-panel.habersoft.com`. Choose the internal origin by topology: `http://127.0.0.1:3200`, `http://host.docker.internal:3200`, or `http://main-service-api:3000`.

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
- `GET /admin-auth/session` fails closed before login;
- invalid login is rejected;
- valid login creates an HttpOnly, `SameSite=Lax`, `Secure`, `/admin-auth` cookie;
- session after login returns safe authenticated state only;
- status dashboard health paths work through `/status-api/health/live` and `/status-api/health/ready`;
- status-api upstream origin is internal and not the public backend edge;
- protected shell is locked before login, unlocked after session, and locked after logout;
- logout invalidates the server-side Redis session;
- no Agent key, Tenant bearer token, JWT, password, password hash, session secret, raw Redis key, raw logs, or raw production response body is copied into Git;
- rollback path is available and does not require unsafe source edits.

## Rollback Boundary

Rollback must be operator-controlled. It may disable `ADMIN_UI_AUTH_MODE`, remove the admin UI edge route, or roll back to a previous immutable image, depending on the authorized production plan. MS-022B does not execute rollback and does not mutate production.

MS-023B keeps rollback-baseline capture operator-managed. Codex does not capture, infer, or assert a production rollback baseline in this package milestone.

## Residuals

Business admin features, feed/user/tenant management UI, Agent operations, and any browser use of Tenant/admin write APIs remain out of scope. The same-origin transport model remains the production activation model; CORS broadening is not part of this package.
