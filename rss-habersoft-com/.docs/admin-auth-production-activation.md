# Admin Auth Production Activation Package

Status: `MS-023A-R2_OPERATOR_MANAGED_PRODUCTION_PACKAGE_READY - NOT_DEPLOYED`.

MS-023A-R2 prepares the backend admin auth/session configuration contract for a later operator-authorized, operator-managed production deployment milestone. It does not deploy the admin UI, mutate production, capture rollback baseline, publish an image, create a Git tag, or request real production secrets.

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

## Secretless Provisioning Helpers

Run from `rss-habersoft-com` only with non-production test values unless a later operator has explicit production secret-handling authority:

```bash
npm run admin-auth:hash
npm run admin-auth:secret
npm run admin-auth:verify-config -- --synthetic --require-enabled
```

`admin-auth:hash` reads the password from `ADMIN_UI_ADMIN_PASSWORD` or stdin. It redacts the generated hash by default; an operator must pass `--emit-sensitive-output` to intentionally print the value for secure external secret storage. `admin-auth:secret` follows the same redacted-by-default pattern for a session secret. `admin-auth:verify-config` validates the current environment or the built-in synthetic config without printing the password hash or session secret.

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
