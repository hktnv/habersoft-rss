# Backup and Restore

## Sorumluluk

Bu belge production PostgreSQL backup prerequisite'ini, backup artifact/metadata/checksum'ini, disposable restore verification'i, Redis reconstructability sinirini ve rollback oncesi data-protection gate'ini aciklar.

## Backup

Backup custom-format `pg_dump -Fc` artifact'idir. MS-019C handoff-v1 historical/superseded durumdadir; production rerun icin handoff-v2 kullanilir. Handoff-v2 `LANDED_MAIN_PINNED_TOOLING` modelindedir: operator once canonical `main` checkout'u `git pull --ff-only origin main` ile landed tooling commit'ine getirir, handoff checksum ve `bash -n` kontrolunu yapar, sonra wrapper `--preflight-only` ile repository identity, required commit ancestry, required tool SHA-256, dirty required-tool guard ve CLI contract version'i dogrular.

Wrapper-level capture interface:

```bash
<approved-ms-019c-handoff-v2-dir>/capture-production-postgres-backup.sh \
  --repository-dir /opt/habersoft-rss \
  --compose-file deploy/production/compose.yaml \
  --shared-env .env.production \
  --runtime-image-env deploy/runtime-image.env \
  --output-dir <absolute-new-empty-output-dir> \
  --preflight-only
```

Capture ayni komutun `--preflight-only` olmadan calistirilmasidir. Core contract version `production-backup-restore-evidence-v1` ve capability komutu:

```powershell
npm run production:backup -- contract:describe
```

Output directory su dosyalari tasir:

- `main-service-production.dump`
- `backup-capture-metadata.json`
- `backup-capture-receipt.json`
- `checksums.sha256`

Script explicit production Compose context kullanir: production compose file, external shared env ve `deploy/runtime-image.env`. Wrapper `--shared-env` degerini bundle-mode core CLI'ye ayni semantikle iletir; legacy file-mode core CLI backward-compatible olarak `--env-file` + `--output <backup.dump>` seklini korur. Bare `docker compose` production backup evidence komutu degildir. Metadata/receipt backup SHA-256, byte size, custom-format contract, parent MS-019B receipt SHA ve no-mutation flags tasir; DB URL, password, raw row data, private path veya dump content yazmaz.

Backup output production host disina tasinmalidir. Gercek backup path, retention schedule ve off-host transfer operasyonel runbook kapsamindadir; bu repository secret veya production dump saklamaz.

MS-018B operator modelinde backup production sunucusunda operator tarafindan tetiklenir. Source delivery yine Git-only kalir; backup artifact'i, SHA-256 kaydi ve off-host kopya Git disinda tutulur. Codex production SSH veya production backup komutu calistirmaz. MS-019C handoff bundle'i external ve secret-free'dir; generation, verification veya preflight production backup evidence degildir. Production capture sirasinda `bash -x`, `set -x`, raw stderr/env paste, feature-branch checkout ve direct core CLI flag guessing kullanilmaz.

## Restore Verification

```powershell
node scripts/production-backup-restore-evidence.mjs authority:create --capture-dir <flat-returned-backup-dir> --output <external-returned-authority-record>
npm run production:restore:verify -- --input-dir <flat-returned-backup-dir> --authority <external-returned-authority-record> --receipt <external-off-host-restore-receipt>
```

Returned authority record exact flat inventory, capture checksums, tree digest, parent MS-019B receipt SHA, backup SHA ve no-secret/no-raw-data flags tasir. Restore wrapper da landed-main-pinned repository tooling closure'i dogrular ve `--preflight-only` destekler. Core capability komutu `npm run production:restore:verify -- contract:describe` seklindedir. Verifier yalniz local Docker engine endpoint sinifini kabul eder, SSH/remote TCP/production alias context'lerini reddeder. Unique disposable network, volume ve PostgreSQL container kullanir; host port yayinlamaz. Dump'i restore eder, beklenen alti canonical business table'i ve iki Prisma migration kaydini kontrol eder, sonra container/network/volume absence proof yapar. Production database overwrite etmez ve staging'e restore yapmaz.

Combined receipt:

```powershell
npm run production:backup-restore:receipt:create -- --capture-dir <flat-returned-backup-dir> --restore-receipt <external-off-host-restore-receipt> --authority <external-returned-authority-record> --handoff <operator-approved-ms-019c-handoff-v2-dir> --output <external-combined-receipt>
npm run production:backup-restore:receipt:verify -- --receipt <external-combined-receipt> --require-backup-restore-baseline
```

Combined receipt parent MS-019B operational receipt SHA-256 `3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620`, handoff-v2 manifest SHA, tooling lock SHA, returned authority SHA, off-host restore receipt SHA ve local verifier commit'ine baglanir. Historical staging backup SHA-256 production backup SHA yerine kullanilamaz.

## Redis Siniri

Redis rate-limit/job scheduler runtime state tasir. Redis kaybi canonical business data kaybi degildir; PostgreSQL canonical state korunur. Redis backup MS-016 data-protection gate'i degildir.

## Rollback Preconditions

MS-016 schema/migration degistirmez. Compatible rollback onceki app image'a donusle sinirlidir. Gelecek incompatible migration iceren release icin verified PostgreSQL backup ve restore plan olmadan rollout yapilmaz.

MS-017 hazirlik tooling'i staging receipt icinde backup checksum ve restore verification alanlarini zorunlu kilar.

MS-017C approved staging drill sirasinda target alias `habersoft-rss-staging-alias` icin PostgreSQL custom-format backup alindi ve off-host disposable PostgreSQL restore verification passed oldu. Backup SHA-256 `595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc`. Restore verifier six canonical business table'i, two Prisma migration kaydini, sentinel row count minimumlarini, entry/detail invariant'ini, agent event varligini ve runtime status varligini kontrol etti. Backup/metadata Git'e alinmadi; production database overwrite edilmedi.

MS-017B2 local rehearsal tooling'i PostgreSQL backup ve disposable restore verification'i izole local Docker project uzerinde dener. Bu kanit production backup veya remote staging backup yerine gecmez.

## Production Evidence Status

MS-019C returned backup-v2 intake ve off-host disposable restore verification accepted durumdadir. External artifacts Git'e commit edilmez; docs yalniz safe identity projection tasir.

- Production backup SHA-256: `1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8`
- Returned authority SHA-256: `f4147ec51fc686aa4c07e3f8c03f79c2bed089f51f191ca7d4db8e7232cc82f8`
- Returned tree digest: `ec9552e9a26ef5572bf3ddf001c0481ffae6b5d09ef748e797e4eba5debe2001`
- Off-host restore receipt SHA-256: `84658697d04a357c9ba311562320b2fed893efcc81e87fc81fc8a8ca41cf9303`
- Combined backup/restore receipt SHA-256: `868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735`
- Production off-host restore result: `PASSED`
- Backup restore baseline: `PASSED`

Bu evidence production backup/restore gate'ini `PRODUCTION_BACKUP_RESTORE_VERIFIED` yapar. Full operational acceptance yine previous production pointer, edge body-limit, long-term stability ve error-burst evidence eksikleri nedeniyle partial kalir.
