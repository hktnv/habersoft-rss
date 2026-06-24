# MVP Release Readiness

## Scope

MS-015, `main-service` repository'sinin mevcut MVP davranisini release-blocker kapilarindan gecirir. MS-016 sonrasi deployment karari kapatilmis, release package dogrulanmis ve MS-018C ile operator-confirmed production activation repository-local PROD dokumantasyonuna gecmistir. `MVP — Production Aktif`, yalniz main-service backend application icin basic production activation acceptance'in passed oldugu anlamina gelir; admin/frontend veya bagimsiz Agent/Tenant uygulamalari release-ready anlamina gelmez.

Application version: `0.1.0-ms-017`

Application status: `MVP — Production Aktif`

Master baseline:

```text
release: rss-habersoft-master-v12
SHA-256: df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430
active Markdown count: 29
```

Source branch ve commit bilgisi final MS-015 raporundan izlenir; bu belge yasayan commit hash'ini kendi icine yazmaz.

## Required Commands

Host/static gate:

```powershell
npm run release:verify
```

Container authoritative MVP acceptance gate:

```powershell
docker compose run --rm main-service-api npm run test:mvp-acceptance
```

Worker readiness:

```powershell
docker compose exec main-service-worker npm run worker:health
```

Clean-room acceptance pattern:

```powershell
git worktree add --detach <TEMP_PATH> HEAD
Copy-Item <TEMP_PATH>\.env.example <TEMP_PATH>\.env
docker compose -p <unique-project> --project-directory <TEMP_PATH> build --no-cache
docker compose -p <unique-project> --project-directory <TEMP_PATH> up -d
docker compose -p <unique-project> --project-directory <TEMP_PATH> run --rm main-service-api npm run test:mvp-acceptance
docker compose -p <unique-project> --project-directory <TEMP_PATH> down -v --remove-orphans
git worktree remove <TEMP_PATH>
git worktree prune
```

Use a unique Compose project name. Destructive cleanup is limited to that unique project.

## Gate Matrix

| Gate | PASS olcutu |
|---|---|
| Master/docs | Master v12 count/hash exact, master files unchanged, repo-local docs fresh. |
| Build/lock/supply-chain | `npm ci`/lock deterministic, production audit zero, registry signature result recorded, SBOM parsed ephemerally. |
| Schema/migrations | `prisma/schema.prisma` and `prisma/migrations/**` unchanged; two migrations apply and second deploy is no-op. |
| Config/role isolation | API, worker, migrate and local JWKS fixture load only their expected configuration. |
| Public contracts | Agent, Tenant and health route inventory matches MS-014; no new public route. |
| Integrated lifecycle | Tenant subscription, Agent ingestion/results and tenant read paths pass together with real PostgreSQL/Redis. |
| Concurrency | Idempotency, replay, out-of-order and concurrent request tests pass. |
| Failure/recovery | Dependency readiness, restart and migration no-op gates pass without corrupting canonical data. |
| Worker/cleanup | BullMQ scheduler registry, global concurrency, cleanup seven-step order and retention side effects pass. |
| Security/privacy | Secret scan, auth isolation and no raw content/credential logging checks pass. |
| Clean-room | Detached worktree no-cache build and acceptance pass without tracked file mutation. |

## Blocker vs Residual Risk

Release blocker is a reproducible failure in build/test/migration/clean-start, canonical contract mismatch, data integrity/auth isolation/idempotency violation, production dependency vulnerability, secret leak, worker readiness lie or cleanup corruption.

Residual non-blocker is a bounded item outside the current MVP repository acceptance scope.

Known residual non-blockers:

- basic production activation acceptance passed with operator-confirmed internal/public live-ready evidence,
- extended operational evidence is partial accepted but full baseline is not passed,
- exact production Git commit, image ID, image revision label, worker health, scheduler inventory, TLS detail and point-in-time restart/OOM snapshot are recorded by MS-019B collector-v2 evidence,
- production backup/restore evidence is verified by MS-019C; previous production pointer, edge body-limit, long-term stability and error-burst evidence are not recorded,
- frontend and `rss-panel.habersoft.com` are planned and not implemented,
- release identity alignment is verified; package-derived staging image identity is not production identity,
- MS-017 staging target/preflight, production IdP readiness-only proof, full staging deployment, backup/restore, rollback and roll-forward drills passed on approved staging,
- external registry publication is not performed,
- admin/frontend is not implemented,
- current dev-only audit advisories are not in the production/runtime dependency gate,
- optional observability dashboard/notification backend is not implemented,
- HA, managed DB/Redis and post-MVP capacity decisions remain future work.

MS-016 package gate details: [production-deployment.md](production-deployment.md), [release-packaging.md](release-packaging.md), [backup-and-restore.md](backup-and-restore.md).

## No Secrets Or Dumps

Acceptance artifacts such as SBOM/audit output, logs, database dumps, Redis dumps, `.env`, coverage and temporary files are not committed. Reports include command/result summaries only.

## Re-run Procedure

For a local re-run, start with a clean working tree, copy `.env.example` to `.env` if needed, then run:

```powershell
npm run release:verify
docker compose build --no-cache
docker compose up -d --force-recreate
docker compose run --rm main-service-api npm run test:mvp-acceptance
docker compose exec main-service-worker npm run worker:health
```

If any required gate fails after a later change, the repository release-readiness claim is invalid until the gate passes again. Fresh contradictory production health evidence blocks expanding the production-active claim.

## Acceptance Result

Status: `MVP — Production Aktif`

Decision: `MVP Kabul Kapisi, MS-017C Staging Drill ve MS-018C Production Basic Activation Acceptance Gecti`

Acceptance date: `2026-06-22`

MS-018C acceptance result is based on operator-confirmed internal/public `/health/live` and `/health/ready` evidence. Exact evidence time beyond the date is not recorded.
