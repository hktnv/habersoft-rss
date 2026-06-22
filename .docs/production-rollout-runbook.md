# Production Rollout Runbook

## Scope

Bu runbook, `main-service` icin kontrollu production rollout, dogrulama ve rollback prosedurunu secret veya vendor-private veri yazmadan anlatir. Bu belge bir production success receipt degildir; gercek basari yalniz public acceptance ve external receipt ile kaydedilir.

## Prerequisites

- Latest `origin/main` uzerinde temiz worktree.
- `0.1.0-ms-017` staging-proven candidate kimligi dogrulanmis.
- Production rollout authorization external ve Git-disinda.
- Production target descriptor factual ve approved.
- Production env external, secret-safe ve validator'dan gecmis.
- Pinned SSH trust ve production marker dogrulanmis.
- Exact candidate package mevcut ve checksum dogru.

## Artifact identity

Rollout, staging'de kanitlanan exact candidate package'i kullanir:

- version: `0.1.0-ms-017`
- source commit: `074d868d09c5b3d6079803480760d9e669b51826`
- package SHA-256: `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`
- image ID: `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919`
- runtime-image.env SHA-256: `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873`

Runtime diff for `src`, `prisma`, `Dockerfile` and production Compose must remain empty between the candidate source and `origin/main`.

## Target/env ownership

Production target, production env, known_hosts, receipts, packages, backups and edge config backups are external artifacts. They are not committed.

Production and staging must use different environment marker, Compose project name, base directory, volumes, Redis/BullMQ prefixes and secrets.

## Preflight

Read-only preflight uses strict SSH, verifies the production marker first, then records OS, architecture, Docker/Compose readiness, project/container/volume/network state, API loopback port state, public 80/443 state, base directory mode, capacity, edge state, DNS/TLS public state and release pointers.

The state must be classified as `ABSENT_FIRST_DEPLOYMENT`, `EXISTING_KNOWN_RELEASE`, `ALREADY_CANDIDATE_HEALTHY` or `UNKNOWN_OR_CONFLICTING`. Unknown or conflicting state blocks mutation.

## Backup gate

For existing production, take a PostgreSQL custom-format backup before mutation and verify disposable off-host restore. For first deployment, take the baseline backup after migrations and before public cutover.

Backup metadata is secret-free and external. Redis is runtime state and is not the canonical business backup gate.

## Deployment sequence

1. Verify authorization and production env.
2. Verify exact package manifest, checksums, SBOM, provenance and runtime image env.
3. Transfer package to immutable release directory.
4. Load image and inspect image identity.
5. Install shared env mode `0600`.
6. Create release-local `runtime-image.env`.
7. Start PostgreSQL and Redis.
8. Run `prisma migrate status`, `prisma migrate deploy`, then status again.
9. Start API and worker.

No `prisma db push`, volume prune, Redis flush or direct public API bind is allowed.

## Internal acceptance

Internal acceptance requires two readiness rounds:

- `/health/live = 200`
- `/health/ready = 200`
- `postgres = up`
- `redis = up`
- `tenantAuth = up`
- worker health passes

Also verify API/worker image identity, loopback-only API bind, no public DB/Redis/worker ports, scheduler `cleanup.daily`, queue `main-service.maintenance`, job `cleanup.run.v1`, timezone `UTC`, global concurrency `1` and local concurrency `1`.

## Edge cutover

Edge configuration is staged only after internal health, backup/restore and rollback plan pass. Existing edge config is backed up before mutation. Syntax test and host-header or resolve-style test should pass before live reload.

DNS is changed only when authenticated provider access exists. If provider access is absent, public rollout is blocked rather than guessed.

## Public acceptance

Public acceptance for `https://rss.habersoft.com` requires:

- HTTP redirects to HTTPS.
- TLS hostname and chain are valid.
- `GET /health/live = 200`.
- `GET /health/ready = 200`.
- Unknown route returns `404`.
- Unauthenticated Tenant route returns `401`.
- Unauthenticated Agent route returns `401`.

The edge body limit must not cut the 5 MiB Agent entries contract.

## Stability checks

Run a bounded observation window with at least ten public/internal health rounds, thirty seconds apart. Restart counts must stay stable, API/worker must remain exact candidate image, PostgreSQL/Redis healthy, tenantAuth up, worker health pass, scheduler single and no OOM/error burst.

## Rollback paths

Before public cutover failure: stop candidate app services, preserve volumes and restore prior edge config if changed.

First-deployment post-cutover failure: restore prior edge/DNS state, stop candidate services, preserve production volumes and clear current pointer.

Existing-production post-cutover failure: use the actual previous production runtime image env, recreate API/worker, verify health and restore pointers/edge/DNS as needed.

DB restore is not default rollback behavior for this release because there is no new migration.

## Current/previous pointers

After success, `current` points to the candidate release. On first deployment, `previous` remains absent or none. On upgrade, `previous` points to the actual prior production release, not the staging rollback package.

## Post-deployment verification

Final receipt verifier must prove identity, authorization hash, preflight, capacity, package/image identity, backup/restore, migration status, internal health, public HTTPS acceptance, stability, pointers and safety flags.

## Forbidden operations

Do not invent production host facts, bypass TLS validation, use staging target as production, reuse staging secrets, expose DB/Redis/worker publicly, bind API directly to public Internet, use HTTP JWKS, reset production DB, rewrite migrations, prune Docker globally, publish artifacts, create Git tag or create GitHub Release.

## Incident handoff

If factual target, capacity, backup, edge, DNS, TLS or health gates fail, stop at the earliest safe point. Generate a secret-free blocked receipt or handoff, preserve production data, and do not mark `main-service` as production active.
