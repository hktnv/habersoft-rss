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
- Extended operational evidence: `PARTIAL_ACCEPTED`

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

## MS-019B Operational Evidence Receipt

MS-019B-R8 accepted a fresh collector-v2 returned bundle as a partial operational evidence receipt. This does not change the application status and does not claim backup/restore, publication or full operational baseline completion.

- Receipt filename: `production-operational-evidence-receipt.json`
- Receipt SHA-256: `3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620`
- Contract: `production-operational-evidence-v2`
- Operational baseline: `PARTIAL`
- Partial reason: previous production pointer fields remain `NOT_RECORDED`
- Authority tree digest: `794b760e98628864773caa109dd8ab5e1c92fa1556e7fa6c3d16827ae55298a9`

Verified safe projections:

| Check | Result | Boundary |
|---|---|---|
| Explicit production Compose context | `PASSED` | Production compose file plus shared env and runtime image env were used by collector-v2. |
| Canonical remote | `PASSED` | Terminal `.git` variant normalized to `https://github.com/hktnv/habersoft-rss`. |
| Runtime Git revision | `PASSED` | Revision `186a30d4c8c09c97bcd37c1f4c787e5c5e49f397` is known in canonical history and ancestor of verified `origin/main`. |
| Server checkout clean flag | `false` | Recorded as point-in-time server state; runtime image/revision identity still matched. |
| Runtime image identity chain | `PASSED` | Runtime env image, API image, worker image and inspected image matched. |
| Service steady state | `PASSED` | API, worker, PostgreSQL and Redis were observed; `migrate` remains a finite role and migration evidence passed separately. |
| Port policy | `PASSED` | API loopback bind `127.0.0.1:3200`; PostgreSQL, Redis and worker have no host port binding. |
| Migration status | `PASSED` | Expected migrations recorded; no pending/failed migration. |
| Worker health and scheduler | `PASSED` | Worker health and scheduler evidence were direct observed. |
| Health, boundary, redirect and TLS | `PASSED` | Internal/public health, unauthenticated boundary smokes, HTTP-to-HTTPS redirect and TLS metadata passed. |
| Point-in-time stability snapshot | `PASSED` | API and worker restart counts were `0`, OOMKilled `false`, state `running`; error-burst analysis remains out of scope. |

## Not Recorded

The following fields remain not proven by current accepted evidence and must not be treated as passed:

- production backup SHA-256: `NOT_RECORDED`
- production off-host restore result: `NOT_RECORDED`
- previous production pointer commit/image: `NOT_RECORDED`
- edge body-limit verification: `NOT_RECORDED`
- long-term stability observation: `NOT_RECORDED`
- error-burst analysis: `NOT_RECORDED`

These gaps are not failures. They are the remaining extended operational evidence scope. The MS-018C external receipt filename and SHA-256 remain unchanged.

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
