# Admin Auth Production Activation Package

Status: `MS-024E_ADMIN_AUTH_CONFIGURED_UNAUTHENTICATED_PRODUCTION_VERIFIED_LOGIN_SMOKE_PENDING`.

MS-024E records operator-reported production retest evidence after MS-024D: backend admin-auth runtime env is live and valid in `main-service-api`, `main-service-worker` intentionally remains without admin-auth env, backend loopback `/admin-auth/session` returns `configured=true`, `authenticated=false`, `reason=unauthenticated`, and the frontend proxy recovered after the canonical overlay helper recreate. It does not claim authenticated admin login/session acceptance, deploy the admin UI, mutate production, capture rollback baseline, publish an image, create a Git tag, or request real production secrets.

MS-023D status-dashboard production transport remains accepted. Historically, `/admin-auth/session -> 501 not_configured` meant backend auth was not active at the proxied upstream. MS-024E intakes the operator report that this residual is resolved to the expected pre-login state: `/admin-auth/session -> configured=true, authenticated=false, reason=unauthenticated` and `auth-smoke:redacted -> AUTH_CONFIGURED_UNAUTHENTICATED` with empty `diagnostic_classes`. `AUTH_CONFIGURED_UNAUTHENTICATED` is not authenticated admin-shell acceptance; it is the state that requires the next operator credentialed redacted login smoke.

## Runtime Contract

The backend consumes these admin auth environment variables only in the API role:

| Variable | Consumed by | Required for `single_admin` | Notes |
|---|---|---:|---|
| `ADMIN_UI_AUTH_MODE` | `loadRuntimeConfig` | yes | `disabled` is the default safe state. `single_admin` enables configured admin auth. |
| `ADMIN_UI_ADMIN_USERNAME` | `loadRuntimeConfig`, login verification | yes | Visible admin login name, 1-128 visible characters, no leading/trailing whitespace. |
| `ADMIN_UI_ADMIN_PASSWORD_HASH` | `loadRuntimeConfig`, `verifyAdminPasswordHash` | yes | Sensitive PBKDF2 hash material. Do not commit real values. |
| `ADMIN_UI_SESSION_SECRET` | `loadRuntimeConfig`, Redis session key HMAC | yes | Sensitive high-entropy secret. Do not commit real values. |
| `ADMIN_UI_SESSION_TTL_SECONDS` | `loadRuntimeConfig`, cookie/session expiry | no | Defaults to `3600`; diagnostics report absent value as `optional_defaulted`. |
| `ADMIN_UI_SESSION_COOKIE_NAME` | `loadRuntimeConfig`, cookie read/write | no | Defaults to `habersoft_admin_session`; diagnostics report absent value as `optional_defaulted`. |
| `ADMIN_UI_SESSION_COOKIE_SECURE` | `loadRuntimeConfig`, cookie builder | production yes | Must be `true` when `APP_ENV=production`; local RC may use `false` on loopback HTTP. |
| `ADMIN_UI_SESSION_REDIS_PREFIX` | `loadRuntimeConfig`, Redis session keys | no | Defaults to `admin_auth:session`; diagnostics report absent value as `optional_defaulted`; use a production-specific lowercase prefix when set. |

The password hash format is:

```text
pbkdf2-sha256$120000$<base64url-salt>$<base64url-digest>
```

The current implementation uses PBKDF2-SHA256, 120000 iterations, at least a 16-byte salt, and at least a 32-byte digest. Generated hashes are operational secret material.

When the hash is placed in `.env.production` for Docker Compose interpolation, write each literal `$` as `$$`. The backend validation helpers accept that Compose-escaped form, and the production Compose render verifier checks that `main-service-api` receives the real single-dollar PBKDF2 format after Compose interpolation.

## Secretless Provisioning Helpers

Run from `rss-habersoft-com` only with non-production test values unless a later operator has explicit production secret-handling authority:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config -- --synthetic --require-enabled
npm run admin-auth:verify-config -- --env-file <path-to-operator-owned-backend-env> --require-enabled
npm run production:admin-auth:diagnose:redacted -- --synthetic
npm run production:admin-auth:compose:verify
```

`admin-auth:hash` reads the password from `ADMIN_UI_ADMIN_PASSWORD` or stdin. It redacts the generated hash by default; an operator must pass `--emit-sensitive-output` to intentionally print the value for secure external secret storage. `admin-auth:secret` follows the same redacted-by-default pattern for a session secret. `admin-auth:verify-config` validates the current environment, the built-in synthetic config, or an operator-owned env file without printing the password hash or session secret. The env-file verifier rejects placeholders, disabled mode when `--require-enabled` is used, missing values, invalid password hashes, and short session secrets.

`production:admin-auth:diagnose:redacted` reports only presence/classes and never prints password hashes or session secrets. It distinguishes `required_missing`, `optional_defaulted`, `configured_present`, `worker_absent_by_design`, `frontend_proxy_recreate_required`, `auth_configured_unauthenticated`, and `authenticated_login_not_yet_proven`. The three optional/defaulted values `ADMIN_UI_SESSION_TTL_SECONDS`, `ADMIN_UI_SESSION_COOKIE_NAME`, and `ADMIN_UI_SESSION_REDIS_PREFIX` must not be treated as required gaps when the strict `single_admin` values are valid. `production:admin-auth:compose:verify` renders production Compose with synthetic values and checks that every admin-auth env name is wired into `main-service-api`, no admin-auth env name is wired into `main-service-worker`, and the default mode remains `disabled`.

## Production Compose Wiring

Docker Compose `--env-file` values are interpolation inputs; they are not automatically visible to containers. The production service must list each required variable under its service `environment:` block. MS-024D adds those mappings to `deploy/production/compose.yaml` for `main-service-api` only:

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

`main-service-worker` intentionally omits these variables because worker runtime config does not read admin auth. For an admin-auth-only activation or rotation, recreate `main-service-api`; recreate `main-service-worker` only when the operator is also rolling a backend image or shared worker-consumed env change.

After any backend API/image/network/admin-auth env recreate, refresh the frontend proxy runtime with the canonical helper:

```bash
cd /opt/habersoft-rss/rss-admin-ui
npm run ops:compose:recreate
```

The helper includes the backend-network overlay when `ADMIN_UI_BACKEND_DOCKER_NETWORK` is configured. Without this frontend recreate, Nginx may retain stale backend upstream/network references and edge status/auth routes can show `502` or `auth_unavailable` even while backend loopback auth is configured.

Tracked examples must use placeholders:

```text
ADMIN_UI_AUTH_MODE=single_admin
ADMIN_UI_ADMIN_USERNAME=<ADMIN_USERNAME>
ADMIN_UI_ADMIN_PASSWORD_HASH=<ADMIN_PASSWORD_HASH>
ADMIN_UI_SESSION_SECRET=<ADMIN_SESSION_SECRET>
ADMIN_UI_SESSION_TTL_SECONDS=3600
ADMIN_UI_SESSION_COOKIE_NAME=habersoft_admin_session
ADMIN_UI_SESSION_COOKIE_SECURE=true
ADMIN_UI_SESSION_REDIS_PREFIX=admin_auth:production
```

## Future Production Authority

A future production activation milestone must be operator-authorized and must provide evidence without raw secrets:

- immutable backend and frontend image identity;
- remote Git SHA;
- production environment variable presence with secret values redacted;
- `GET /admin-auth/session` fail-closed before login;
- login, session, logout smoke with redacted request/response evidence;
- cookie evidence showing `HttpOnly`, `SameSite=Lax`, path `/admin-auth`, and `Secure` under TLS production;
- no Agent key, Tenant bearer token, password, password hash, session secret, Redis session key, raw log, or raw body disclosure;
- rollback path and exact image/env identity used for rollback.

MS-023A-R2 local RC validation is not production evidence. It uses synthetic credentials, loopback/Docker networking, local PostgreSQL, local Redis, local JWKS fixture, same-origin frontend paths, and no production deployment. Rollback baseline and server-side deployment/configuration remain operator-managed.

MS-024A adds redacted frontend smoke support for later operator evidence: `npm run auth-smoke:redacted` classifies session state by default, and optional `--login-smoke` uses `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` environment variables only. Do not paste real admin credentials, cookies, password hashes, session secrets, Redis keys, raw logs, or raw production response bodies into Git/chat/docs. No CORS broadening is part of the MS-024A package.

MS-024E keeps that claim boundary and improves diagnostics/runbook guidance. If the frontend status proxy is reachable and `/admin-auth/session` returns `configured=true`, `authenticated=false`, `reason=unauthenticated`, treat `AUTH_CONFIGURED_UNAUTHENTICATED` as the expected pre-login state. The verifier command remains:

```bash
npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled
```

Backend API recreate after env placement is an operator rollback/config decision and is not performed by Codex. Worker recreate is not required solely for backend admin-auth env placement. Authenticated admin-shell production acceptance remains pending until the operator supplies `ADMIN_AUTH_SMOKE_USERNAME` and `ADMIN_AUTH_SMOKE_PASSWORD` as environment variables to `npm run auth-smoke:redacted -- --endpoint https://rss-panel.habersoft.com` and reports a redacted `AUTHENTICATED_ADMIN_ACCEPTED` result.
