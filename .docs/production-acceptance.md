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
- Production backup/restore evidence: `PRODUCTION_BACKUP_RESTORE_VERIFIED`
- Production checkout/current pointer evidence: `PARTIAL_ACCEPTED`

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

MS-019B-R8 accepted a fresh collector-v2 returned bundle as a partial operational evidence receipt. MS-019B alone does not change the application status and does not claim backup/restore, publication or full operational baseline completion.

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

## MS-019C Backup Restore Receipt

MS-019C accepted the returned production backup-v2 bundle, created a safe returned authority record, verified a disposable off-host PostgreSQL restore on a local Docker engine, and created the combined backup/restore receipt. Raw dump bytes, row data, production env values, private paths, host/user details and raw SQL are not stored in repository docs.

- Returned authority filename: `production-backup-returned-v2-authority.json`
- Returned authority SHA-256: `f4147ec51fc686aa4c07e3f8c03f79c2bed089f51f191ca7d4db8e7232cc82f8`
- Returned tree digest: `ec9552e9a26ef5572bf3ddf001c0481ffae6b5d09ef748e797e4eba5debe2001`
- Production backup SHA-256: `1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8`
- Off-host restore receipt filename: `off-host-restore-receipt-v2.json`
- Off-host restore receipt SHA-256: `84658697d04a357c9ba311562320b2fed893efcc81e87fc81fc8a8ca41cf9303`
- Combined receipt filename: `production-backup-restore-receipt.json`
- Combined receipt SHA-256: `868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735`
- Backup restore baseline: `PASSED`
- Handoff-v2 manifest SHA-256: `066fd8354fa8bb1ccc43db4fb177f7f2d54b5e56e4f5665bc591d183aa8e39d8`

## MS-019D-R1 Checkout Pointer Receipt

MS-019D-R1 accepted the returned checkout/pointer bundle as a partial checkout pointer receipt. Codex did not contact production, did not mutate production Git/Docker/Compose state, did not read production env values and did not edit returned evidence files.

- Returned authority filename: `production-checkout-pointer-returned-v1-authority.json`
- Returned authority SHA-256: `44be2ff5d3d666ba359ac0af9c206c593ab0a6e2cc0a5bc630f5079c9c4ad8a9`
- Returned tree digest: `39589acae16aeeee649caa44df82dff5483e59537a2a2b05e7adcaf3f60f4bc0`
- Receipt filename: `production-checkout-pointer-receipt.json`
- Receipt SHA-256: `e823ec819d471c8bb3c5052e6def3a6830731058952971675bdd4ae4d1f6c63a`
- Collection UTC: `2026-06-25T13:52:49Z`
- Outcome: `PARTIAL_ACCEPTED`
- Rollback baseline state filename: `production-release-pointer-state.json`
- Rollback baseline state SHA-256: `ce6908a1196451c5737086943c4b9a9ad116ccc7d45c953fab6b2eb17936681c`

Verified safe projections:

| Check | Result | Boundary |
|---|---|---|
| Checkout hygiene | `PASSED` | Classification `ALLOWLISTED_EXTERNAL_STATE_IGNORED`; tracked, unknown untracked and operation-in-progress counts were zero. |
| Production checkout commit | `PASSED` | `1745fcb250208ffa22aac5aac745cda49dcfd865` on branch `main`, normalized canonical remote `https://github.com/hktnv/habersoft-rss`. |
| Current runtime image identity | `PASSED` | Runtime env image, API image, worker image and inspected image matched `sha256:441daac4dc406059fc640df645366f491d34f4cd5fa868852dc24a32ad78865b`. |
| Current runtime revision | `PASSED` | OCI revision `186a30d4c8c09c97bcd37c1f4c787e5c5e49f397` is known in canonical history and ancestor of verified `origin/main`. |
| OCI source | `PASSED` | Source normalized to `https://github.com/hktnv/habersoft-rss`. |
| Checkout/runtime equality | `false` | Accepted by MS-019D-R1 because checkout is clean at current `origin/main` and runtime revision is a verified ancestor. |
| Historical previous pointer | `NOT_RECORDED` | No strict previous pointer file was supplied; no staging/image-recency/Git-parent inference was used. |
| Rollback baseline for next deployment | `ESTABLISHED_FROM_CURRENT_POINTER` | Forward-looking external state records the current verified pointer as the value to rotate before the next runtime mutation. |
| Production mutation flags | `false` | No deployment, restart, migration, backup, restore, tag, release or artifact publication was performed by this intake. |

## Not Recorded

The following fields remain not proven by current accepted evidence and must not be treated as passed:

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
