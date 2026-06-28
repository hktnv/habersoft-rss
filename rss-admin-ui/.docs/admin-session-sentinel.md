# Admin Session Static Fallback

Status: `MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY - NOT_DEPLOYED`.

MS-021B introduced the same-origin not_configured sentinel. MS-022A keeps that behavior as the default static fail-closed mode whenever server-only `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is absent.

## Static Fallback Routes

```text
GET  /admin-auth/session
POST /admin-auth/login
POST /admin-auth/logout
```

In static fallback mode:

- `GET /admin-auth/session` returns HTTP `501` with `authenticated: false`.
- `POST /admin-auth/login` returns a safe fail-closed not_configured response and sets no cookie.
- `POST /admin-auth/logout` returns a safe fail-closed not_configured response and sets no cookie.
- wrong methods return `405`.
- unknown `/admin-auth/**` paths return `404` and do not fall back to the SPA.
- query strings are ignored and never reflected.
- nothing is proxied upstream.
- `Cache-Control: no-store` is applied.
- `Set-Cookie` and `WWW-Authenticate` are not emitted by the static fallback.

Representative response:

```json
{
  "configured": false,
  "status": "not_configured",
  "authenticated": false,
  "reason": "not_configured",
  "message": "Admin authentication is not configured."
}
```

## Activated Proxy Replacement

When `ADMIN_UI_AUTH_UPSTREAM_ORIGIN` is configured, the frontend runtime replaces the static fallback with exact same-origin proxy routes for `/admin-auth/session`, `/admin-auth/login`, and `/admin-auth/logout`. The proxy strips arbitrary browser headers, forwards only bounded JSON/cookie material needed for auth, clears query strings, rejects unknown paths, and keeps transport failures bounded.

The static fallback remains important for production safety: an unprovisioned or undeployed admin UI must fail closed rather than inventing an authenticated state.
