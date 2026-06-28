# rss-admin-ui API/Auth Contract

Status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

`rss-admin-ui` remains not deployed. MS-022A adds a local/tested admin auth/session foundation and keeps production activation separate.

## Health Transport

The read-only health dashboard still uses only:

```text
GET /status-api/health/live
GET /status-api/health/ready
```

The frontend runtime maps those routes to backend `/health/live` and `/health/ready` through server-only `ADMIN_UI_HEALTH_UPSTREAM_ORIGIN`. Health requests use `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, no auth header, no cookie, no Tenant bearer, no Agent key, no browser persistence, and no write method.

## Admin Auth Transport

The browser auth/session API is exact and same-origin:

```text
GET  /admin-auth/session
POST /admin-auth/login
POST /admin-auth/logout
```

The frontend runtime activates the auth proxy only when server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured. With no auth upstream, the MS-021B static fail-closed sentinel remains active.

The backend admin auth mode is disabled by default:

```text
ADMIN_UI_AUTH_MODE=disabled
```

Local/test `single_admin` mode requires explicit synthetic values for username, PBKDF2 password hash, session secret, TTL, cookie name, secure flag, and Redis prefix. There is no default credential.

## Session Boundary

Sessions are server-side opaque sessions. The browser receives only an HttpOnly `SameSite=Lax` cookie scoped to `/admin-auth`; JavaScript never reads or stores the session value. The browser source and static assets must not include Agent key material, Tenant bearer tokens, JWTs, refresh tokens, cookie secrets, production secrets, database URLs, private keys, or browser persistence APIs.

## Write Boundary

Business API writes remain out of scope. Tenant APIs keep their existing bearer-token semantics. Agent APIs keep their existing `X-Agent-Key` semantics. No Tenant bearer or Agent key is introduced into the browser.

## Production Boundary

No production deployment, production edge mutation, backend CORS broadening, registry publication, Git tag, or release is part of MS-022A. Production env/secret provisioning and admin UI activation remain separate operator-authorized work.
