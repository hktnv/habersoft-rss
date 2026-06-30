# Admin Auth Production Activation Package

Status: `MS-024D_BACKEND_ADMIN_AUTH_RUNTIME_ENV_WIRING_READY_OPERATOR_RETEST_REQUIRED`.

MS-024D prepares the backend admin auth/session configuration contract for a later operator-authorized, operator-managed production activation milestone and lands the production Compose runtime env wiring for the backend API service. It does not deploy the admin UI, mutate production, capture rollback baseline, publish an image, create a Git tag, or request real production secrets.

MS-023D status-dashboard production transport remains accepted. MS-023D status-dashboard production evidence leaves backend admin auth as `AUTH_NOT_CONFIGURED_RESIDUAL`: `/admin-auth/session` returns HTTP `501` with `status=not_configured` while `/healthz` and `/status-api/health/*` pass through the admin UI. In MS-024D, `/admin-auth/session -> 501 not_configured` means backend auth is not active at the proxied upstream. That result is not fixed by changing `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. The next operator action is to verify these backend admin-auth variables are present in the backend API service runtime, then restart/recreate `main-service-api` under the operator rollback plan. Passing these variables only to the frontend/admin UI Compose command or placing values only in `rss-admin-ui/.env.production` is insufficient and does not enable backend auth.

## Runtime Contract

The backend consumes these admin auth environment variables only in the API role:

| Variable | Consumed by | Required for `single_admin` | Notes |
|---|---|---:|---|
| `ADMIN_UI_AUTH_MODE` | `loadRuntimeConfig` | yes | `disabled` is the default safe state. `single_admin` enables configured admin auth. |
| `ADMIN_UI_ADMIN_USERNAME` | `loadRuntimeConfig`, login verification | yes | Visible admin login name, 1-128 visible characters, no leading/trailing whitespace. |
| `ADMIN_UI_ADMIN_PASSWORD_HASH` | `loadRuntimeConfig`, `verifyAdminPasswordHash` | yes | Sensitive PBKDF2 hash material. Do not commit real values. |
| `ADMIN_UI_SESSION_SECRET` | `loadRuntimeConfig`, Redis session key HMAC | yes | Sensitive high-entropy secret. Do not commit real values. |
| `ADMIN_UI_SESSION_TTL_SECONDS` | `loadRuntimeConfig`, cookie/session expiry | no | Defaults to `3600`; local RC uses synthetic `900`. |
| `ADMIN_UI_SESSION_COOKIE_NAME` | `loadRuntimeConfig`, cookie read/write | no | Defaults to `habersoft_admin_session`. |
| `ADMIN_UI_SESSION_COOKIE_SECURE` | `loadRuntimeConfig`, cookie builder | production yes | Must be `true` when `APP_ENV=production`; local RC may use `false` on loopback HTTP. |
| `ADMIN_UI_SESSION_REDIS_PREFIX` | `loadRuntimeConfig`, Redis session keys | no | Defaults to `admin_auth:session`; use a production-specific lowercase prefix. |

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

`production:admin-auth:diagnose:redacted` reports only presence/classes and never prints password hashes or session secrets. `production:admin-auth:compose:verify` renders production Compose with synthetic values and checks that every admin-auth env name is wired into `main-service-api`, no admin-auth env name is wired into `main-service-worker`, and the default mode remains `disabled`.

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

MS-024D keeps that claim boundary and improves residual diagnostics only. If the frontend status proxy is reachable but `/admin-auth/session` returns `501 not_configured`, treat `AUTH_NOT_CONFIGURED_RESIDUAL` as backend runtime activation work. The redacted diagnostic classes are: backend admin-auth mode disabled or missing, backend admin username missing or placeholder, backend password hash missing/placeholder/invalid, backend session secret missing/weak, backend Redis/session dependency unreachable, or frontend proxy reachable while the backend auth endpoint reports not configured. The verifier command remains:

```bash
npm run admin-auth:verify-config -- --env-file <operator-backend-auth-env> --require-enabled
```

Backend API recreate after env placement is an operator rollback/config decision and is not performed by Codex. Worker recreate is not required solely for backend admin-auth env placement.
