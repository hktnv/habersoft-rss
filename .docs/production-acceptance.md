# Production Acceptance

## Sorumluluk

Bu belge `main-service` icin current production activation status'unun repository-local canonical sahibidir. Tek sorumlulugu operator-confirmed MS-018C evidence ozetini, kanitlanan ve kanitlanmayan alanlari, external secret-free receipt kimligini ve claim boundary'yi ayirmaktir.

Bu belge production redeploy, server command log'u, exact production Git/image identity veya full operational acceptance receipt'i degildir. Kopyalanabilir operator komutlari root [PRODUCTION.md](../PRODUCTION.md) dosyasinda kalir.

## Current Status

- Application version: `0.1.0-ms-017`
- Application status: `MVP — Production Aktif`
- Evidence date: `2026-06-22`
- Evidence source: `operator-confirmed transcript`
- Basic activation acceptance: `PASSED`
- Extended operational acceptance: `PARTIAL_NOT_FULLY_RECORDED`

`Production Aktif` yalniz `main-service` backend application icindir. Bagimsiz Agent application, bagimsiz Tenant applications, frontend/admin panel veya `rss-panel.habersoft.com` icin readiness iddiasi degildir.

## Operator-Confirmed Evidence

| Check | Result | Boundary |
|---|---|---|
| Internal liveness `GET http://127.0.0.1:3200/health/live` | `PASSED`, HTTP `200`, response status `live` | Operator-confirmed loopback evidence. |
| Internal readiness `GET http://127.0.0.1:3200/health/ready` | `PASSED`, HTTP `200`, response status `ready` | Operator-confirmed loopback evidence. |
| Public liveness `GET https://rss.habersoft.com/health/live` | `PASSED`, HTTP `200`, response status `live` | Operator-confirmed public HTTPS evidence. |
| Public readiness `GET https://rss.habersoft.com/health/ready` | `PASSED`, HTTP `200`, response status `ready` | Operator-confirmed public HTTPS evidence. |
| PostgreSQL readiness | `up` | From readiness dependency body. |
| Redis readiness | `up` | From readiness dependency body. |
| tenantAuth readiness | `up` | From readiness dependency body. |
| API loopback upstream | `127.0.0.1:3200` | Operator default upstream for RSS backend API. |

MS-018C did not require Codex to repeat public health checks. No local public recheck is used as the canonical source in this document.

## External Receipt

The actual receipt is external and untracked. Repository docs identify it by stable filename and checksum only:

- Receipt filename: `production-acceptance-receipt.json`
- Receipt SHA-256: `62b0e21bf76f21a5db04698f3d593bf1592d370eef06f50169ab63b2cc3b8163`
- Receipt schema/verifier: `node scripts/production-acceptance-receipt.mjs verify --receipt <external-receipt>`

The receipt contains no production `.env` values, tokens, Agent keys, credentials, raw logs, private host details, package archives, images or backups.

## Not Recorded

The following fields are not proven by the MS-018C operator input and must not be treated as passed production identity:

- production Git commit: `NOT_RECORDED`
- production Docker image ID: `NOT_RECORDED`
- production image revision label: `NOT_RECORDED`
- Docker Compose service inventory output: `NOT_RECORDED`
- migration status output: `NOT_RECORDED`
- worker health output: `NOT_RECORDED`
- scheduler inventory output: `NOT_RECORDED`
- production backup SHA-256: `NOT_RECORDED`
- production off-host restore result: `NOT_RECORDED`
- TLS fingerprint or expiry: `NOT_RECORDED`
- HTTP-to-HTTPS redirect result: `NOT_RECORDED`
- unknown route `404` smoke: `NOT_RECORDED`
- unauthenticated Tenant route `401` smoke: `NOT_RECORDED`
- unauthenticated Agent route `401` smoke: `NOT_RECORDED`
- current/previous production pointer identity: `NOT_RECORDED`
- restart counters, OOM or error-burst observation: `NOT_RECORDED`
- edge body-limit verification: `NOT_RECORDED`

These gaps are not failures. They are the remaining extended operational evidence scope.

## Delivery And Publication Boundary

Production source delivery remains Git-only:

```text
local development/test
-> Git commit
-> push origin main
-> operator server-side git pull --ff-only origin main
-> operator server-local Docker build
-> operator Compose migrate/up
```

The following were not performed by MS-018C:

- artifact publication: `NOT_PERFORMED`
- external registry publication: `NOT_PERFORMED`
- Git tag: `NOT_CREATED`
- GitHub Release: `NOT_CREATED`
- frontend/rss-panel activation: `NOT_IMPLEMENTED_INACTIVE`

Staging package source commit `074d868d09c5b3d6079803480760d9e669b51826`, staging image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919`, historical `origin/main` SHA values and the current docs milestone base SHA are not production identity evidence.
