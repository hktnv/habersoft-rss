# Admin Session Sentinel

Status: `REAL_AUTH_NOT_IMPLEMENTED - SAME_ORIGIN_AUTH_SENTINEL_ONLY - NOT_DEPLOYED`.

MS-021B defines the browser-visible admin session status contract without implementing real auth, login, session storage, credential exchange, backend routes, CORS changes, or production deployment.

## Browser Path

```text
GET /admin-auth/session
```

The path is relative and same-origin only. The browser client uses `credentials: "omit"`, `cache: "no-store"`, `Accept: application/json`, no request body, no auth header, no Agent key, no Tenant bearer token, no query token, and a bounded timeout.

## Current Sentinel Response

The static frontend runtime returns a deterministic not_configured sentinel:

```text
HTTP 501 Not Implemented
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "status": "not_configured",
  "authenticated": false,
  "message": "Admin authentication is not configured."
}
```

The response must not set cookies, ask for browser auth, expose upstream URLs, identify a user or Tenant, include roles, include tokens, or leak server diagnostics.

## Runtime Route Rules

- `GET /admin-auth/session` returns the static not_configured sentinel.
- Non-GET methods to `/admin-auth/session` return safe method rejection.
- Unknown `/admin-auth/**` paths return `404` and do not fall back to the SPA.
- Query strings are ignored and never reflected.
- `/admin-auth/**` is not proxied upstream.
- Cache is disabled with `no-store`.
- `Set-Cookie` and `WWW-Authenticate` are not emitted by the sentinel.

## Client State Model

The client represents:

```text
unknown
checking
not_configured
auth_unavailable
invalid_response
timeout
```

Every state is fail-closed in MS-021B. Responses that look like a real principal, role, Tenant, token, redirect, login page, malformed JSON, or `authenticated: true` are treated as invalid and do not unlock protected content.

## Protected Shell

The protected admin/business shell consumes the sentinel state only to explain why access is blocked. It does not render privileged data, business metrics, write controls, fake identity, a password form, a token field, or a logout button.

## Forbidden Patterns

Browser source, built assets, runtime config, and static output must not include Agent key material, Tenant bearer tokens, passwords, JWTs, refresh tokens, cookie secrets, private keys, database URLs, production env files, browser auth persistence, fake authenticated identity, admin writes, or business API mutations.

## Future Replacement Gates

Replacing the sentinel requires a separate operator-authorized real auth/session milestone that defines browser session authority, credential transport, token storage policy, CSRF and XSS stance, refresh/logout semantics, same-origin edge behavior, Tenant/admin identity, role/permission model, public versus authenticated fields, backend route inventory, production activation evidence, and rollback evidence.
