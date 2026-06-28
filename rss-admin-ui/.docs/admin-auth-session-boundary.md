# Admin Auth Session Boundary

Status: `REAL_AUTH_NOT_IMPLEMENTED - SAME_ORIGIN_AUTH_SENTINEL_ONLY - AUTHORITY_REQUIRED_BEFORE_BUSINESS_ADMIN_FEATURES - NOT_DEPLOYED`.

MS-021A adds a frontend-only protected admin/business shell foundation. It does not implement real login, credential exchange, token issuance, refresh, logout, cookies, browser token storage, backend routes, CORS changes, or production deployment.

MS-021B adds only the same-origin admin session status sentinel at `GET /admin-auth/session`. The current static runtime returns a fail-closed not_configured sentinel and the browser client treats unavailable, invalid, timeout, and authenticated-looking responses as blocked. See [admin-session-sentinel.md](admin-session-sentinel.md).

## Current Boundary

- The status dashboard is public read-only and continues to observe only `/status-api/health/live` and `/status-api/health/ready`.
- The health client sends no credentials and stores no health response in browser storage.
- The protected admin/business shell is present only as a blocked, unconfigured boundary.
- The protected shell consumes the MS-021B same-origin session sentinel but never treats it as real auth.
- No privileged admin data, Tenant data, feed administration data, fake user identity, fake tenant identity, or business metrics are loaded.
- Agent key, `X-Agent-Key`, Tenant bearer tokens, passwords, JWTs, refresh tokens, cookie secrets, private keys, and database URLs are forbidden in the browser.

## Forbidden Browser Patterns

The browser application must not introduce:

- Agent key or `X-Agent-Key`,
- Tenant bearer token or hardcoded bearer token,
- password collection or credential exchange,
- JWT or refresh token persistence,
- cookie-based app auth manipulation,
- `localStorage`, `sessionStorage`, IndexedDB, or cookie storage for auth/session,
- backend secrets, `DATABASE_URL`, Redis secrets, private keys, or `.env.production`,
- fake authenticated user, fake tenant, fake role, fake admin metrics, or fake privileged data,
- admin write flows or business API mutation flows.
- fake authenticated success from `/admin-auth/session`.

## Future Contract Questions

A future real auth/session milestone must define and authorize:

- browser auth/session authority,
- cookie versus bearer policy,
- token storage policy,
- CSRF and XSS stance,
- refresh and logout semantics,
- same-origin edge and CORS stance,
- Tenant/admin identity boundary,
- role and permission model,
- public versus authenticated field classification,
- backend route inventory and release impact,
- production activation and evidence steps.

## Future Acceptance Gates

Before any business admin feature is exposed, the future milestone must prove:

- real auth/session authority is approved,
- credential transport and storage are tested,
- protected surfaces fail closed when auth is absent or misconfigured,
- status-only health remains public and credential-free,
- Agent operations remain server/agent-only and absent from the browser,
- no backend source/API/CORS/Prisma/package/version change occurs without explicit authority,
- production deployment remains separately authorized with evidence.
