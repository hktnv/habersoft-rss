# Production Rollout Runbook

## Scope

Bu runbook, `main-service` icin production handoff, kabul, rollback ve blocked-handoff politikasini secret veya vendor-private veri yazmadan anlatir. Bu belge bir production success receipt degildir; current activation status ve receipt identity [production-acceptance.md](production-acceptance.md) dosyasindadir.

Active production handoff'un kopyalanabilir komut kaynagi root [../PRODUCTION.md](../PRODUCTION.md) dosyasidir. Operator source'u yalniz Git uzerinden alir; lokal source upload, Codex SSH ve Codex tarafindan server Docker/OpenLiteSpeed mutation yoktur. Bu dosya gate/receipt mantigini aciklar ve operator guide'i tekrar etmez.

## Active Production Handoff Model

Production source delivery modeli:

```text
local development/test
-> Git commit
-> push origin main
-> operator server-side git pull --ff-only origin main
-> operator server-local Docker build
-> operator Compose migrate/up
```

Direct source upload, package directory transfer, image tar transfer veya panel upload active production source modelinin parcasi degildir. Production identity contract operator-pulled Git commit ve server-built immutable image ID uzerinden tutulur.

## Historical Staging Artifact Evidence

MS-017C staging drill sirasinda staging candidate package ve image kimlikleri dogrulandi. Bu degerler tarihsel staging evidence olarak kalir:

- candidate source commit: `074d868d09c5b3d6079803480760d9e669b51826`
- candidate package SHA-256: `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`
- candidate image ID: `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919`
- candidate runtime-image.env SHA-256: `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873`

Bu staging package-derived kimlikler production Git commit'i, production Docker image ID'si veya current/previous production pointer identity yerine gecmez.

## Acceptance Levels

`Production active` ve `full operational acceptance complete` ayni iddia degildir.

Basic production activation acceptance, MS-018C operator evidence ile passed:

- internal `/health/live`: `PASSED`
- internal `/health/ready`: `PASSED`
- public HTTPS `/health/live`: `PASSED`
- public HTTPS `/health/ready`: `PASSED`
- PostgreSQL readiness: `up`
- Redis readiness: `up`
- tenantAuth readiness: `up`
- API loopback upstream: `127.0.0.1:3200`

Extended operational acceptance partial/not fully recorded:

- production exact Git commit: `NOT_RECORDED`
- production exact image ID / revision label: `NOT_RECORDED`
- migration status output: `NOT_RECORDED`
- worker health: `NOT_RECORDED`
- scheduler inventory: `NOT_RECORDED`
- production backup SHA-256: `NOT_RECORDED`
- production off-host restore result: `NOT_RECORDED`
- TLS fingerprint/expiry: `NOT_RECORDED`
- HTTP-to-HTTPS redirect, unknown route, Tenant unauth and Agent unauth smokes: `NOT_RECORDED`
- current/previous production pointers: `NOT_RECORDED`
- restart/OOM/error-burst stability: `NOT_RECORDED`
- edge body-limit verification: `NOT_RECORDED`

Bu eksik extended evidence, basic production-active status'unu geriye donuk olarak inactive/pending duruma cevirmez. Fresh contradictory health evidence ortaya cikarsa false success uretmek yerine blocker politikasi uygulanir.

## Target/env ownership

Production target, production env, receipts, backups, edge config backups and operator-state files external artifacts'tir. They are not committed.

Production and staging must use different environment marker, Compose project name, base directory, volumes, Redis/BullMQ prefixes and secrets.

## Preflight

Operator production mutation oncesi target state'i read-only siniflandirir. Unknown or conflicting state mutation'u bloke eder.

Preflight evidence current MS-018C acceptance icinde tam kaydedilmemistir. Bu nedenle exact production commit/image, migration status, worker/scheduler, backup/restore, TLS, pointer ve stability alanlari `NOT_RECORDED` kalir.

## Backup gate

For existing production, take a PostgreSQL custom-format backup before mutation and verify disposable off-host restore. For first deployment, take the baseline backup after migrations and before public cutover.

MS-018C inputunda production backup SHA-256 veya off-host restore result kaydedilmedi. Bu alanlar failed degil, `NOT_RECORDED` durumundadir ve MS-019 operational evidence gap'i olarak kalir.

## Deployment sequence

Active production deployment sequence'in canonical komutlari [../PRODUCTION.md](../PRODUCTION.md) dosyasindadir:

1. Verify authorization and production env.
2. Fetch/switch/pull canonical Git source with `--ff-only`.
3. Build server-local immutable Docker image from exact checkout.
4. Generate `deploy/runtime-image.env` from the built image ID.
5. Start PostgreSQL and Redis.
6. Run migration status/deploy as operator procedure requires.
7. Start or recreate API and worker.
8. Verify internal and public health.

No `prisma db push`, volume prune, Redis flush, source upload, package transfer-as-production-source or direct public API bind is allowed.

## Internal and Public Acceptance

Current known activation evidence is limited to live/ready and readiness dependency status. Worker health, scheduler inventory, migration status, route smoke, TLS detail and stability observation remain `NOT_RECORDED`.

Future full operational acceptance should record these as explicit passed evidence or keep them `NOT_RECORDED`; it must not infer them from package, staging or Git base SHA.

## Rollback paths

Before public cutover failure: stop candidate app services, preserve volumes and restore prior edge config if changed.

Existing-production post-cutover failure: use the actual previous production runtime image env, recreate API/worker, verify health and restore pointers/edge/DNS as needed.

DB restore is not default rollback behavior for this release because there is no new migration. DB restore requires verified backup/restore evidence and an explicit data/schema reason.

## Current/previous pointers

MS-018C input did not record current or previous production pointer identity. Future receipts should record actual current/previous production identity when operator evidence exists.

## Post-deployment verification

Future full receipt verifier should prove identity, authorization hash, preflight, capacity, Git commit/image identity, backup/restore, migration status, internal health, public HTTPS acceptance, worker/scheduler, stability, pointers and safety flags.

MS-018C external receipt intentionally records only the operator-confirmed basic activation evidence and leaves the remaining fields explicit `NOT_RECORDED`.

MS-019A prepared the future read-only operational evidence handoff and receipt verifier in [production-operational-evidence.md](production-operational-evidence.md). That flow is for later operator-run evidence capture; it does not replace the current production activation status and does not make backup/restore or publication evidence passed. The copyable collector command shape is kept in that canonical document so this runbook does not duplicate the contract.

## Forbidden operations

Do not invent production host facts, bypass TLS validation, use staging target as production, reuse staging secrets, expose DB/Redis/worker publicly, bind API directly to public Internet, use HTTP JWKS, reset production DB, rewrite migrations, prune Docker globally, publish artifacts, create Git tag or create GitHub Release.

## Incident handoff

If factual target, capacity, backup, edge, DNS, TLS or health gates fail in a future operation, stop at the earliest safe point. Generate a secret-free blocked receipt or handoff, preserve production data, and do not expand `MVP — Production Aktif` beyond the evidence actually recorded.
