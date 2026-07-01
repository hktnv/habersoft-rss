# rss-admin-ui API/Auth Contract

Status: `MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED`.

Historical foundation status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

MS-022A adds a local/tested admin auth/session foundation and keeps production activation separate. MS-025A adds a protected read-only operations summary route, later accepted in production by operator-reported MS-025A-R2 evidence. MS-025B adds a protected read-only operations drilldown route locally. Drilldown production acceptance is closed by operator-reported MS-025B-R1 live retest evidence.

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

Sessions are server-side opaque sessions. The browser receives only an HttpOnly `SameSite=Lax` cookie scoped to `/`; JavaScript never reads or stores the session value. Login clears the historical `Path=/admin-auth` cookie, and logout clears both `Path=/` and `Path=/admin-auth`. The browser source and static assets must not include Agent key material, Tenant bearer tokens, JWTs, refresh tokens, cookie secrets, production secrets, database URLs, private keys, or browser persistence APIs.

## Admin Operations Transport

The authenticated read-only operations API is exact and same-origin:

```text
GET /admin-api/operations/summary
GET /admin-api/operations/drilldown
```

The browser uses `credentials: "same-origin"`, `cache: "no-store"`, `Accept: application/json`, and no Authorization, Tenant bearer, Agent key, or custom credential header. The frontend runtime proxies these paths through server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN`, forwards the session cookie only, strips query forwarding, drops request bodies, hides upstream `Set-Cookie`, `WWW-Authenticate`, and CORS response headers, and maps unauthenticated/unavailable states to bounded JSON.

The response is aggregate-only: dependency state, feed counts, entry counts, ingestion counts, generated timestamp, window, and safe notes. It must not expose tenant identifiers, feed URLs, entry content, raw logs, raw upstream bodies, upstream origins, password hashes, session secrets, cookies, Agent keys, Tenant tokens, or database/Redis URLs.

The drilldown response is bounded with `window.recentHours=24`, `window.maxRows=20`, opaque `displayId`, public `sourceHost`, safe statuses, safe counts, safe timestamps, safe notes, and `capabilities`. It must not expose raw feed URL paths or queries, entry content, raw logs, raw request/response bodies, private hostnames, tenant identifiers, password hashes, session secrets, cookies, Agent key values, Tenant bearer tokens, JWT claims, localStorage, sessionStorage, IndexedDB, cookieStore, document.cookie, or write controls.

## Write Boundary

Business API writes remain out of scope. Tenant APIs keep their existing bearer-token semantics. Agent APIs keep their existing `X-Agent-Key` semantics. No Tenant bearer or Agent key is introduced into the browser.

## Production Boundary

No production deployment, production edge mutation, backend CORS broadening, registry publication, Git tag, or release is part of MS-025B. Production env/secret provisioning remains operator-authorized work. MS-025B-R1 drilldown production acceptance is closed by operator report. No production deployment was performed by Codex for MS-025B-R1.
