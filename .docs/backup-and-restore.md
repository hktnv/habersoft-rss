# Backup and Restore

## Sorumluluk

Bu belge production PostgreSQL backup prerequisite'ini, backup artifact/metadata/checksum'ini, disposable restore verification'i, Redis reconstructability sinirini ve rollback oncesi data-protection gate'ini aciklar.

## Backup

Backup custom-format `pg_dump -Fc` artifact'idir. Script:

```powershell
npm run production:backup -- --compose-file <compose-file> --env-file <shared-env> --runtime-image-env <release-dir>/runtime-image.env --output <temp-backup>
```

Script backup dump ile birlikte `<temp-backup>.metadata.json` uretir. Metadata checksum, format, database adi ve timestamp tasir; password yazmaz. `--runtime-image-env` Compose interpolation icin package-derived image identity katmanini ekler; backup icinde image veya secret saklanmaz.

Backup output production host disina tasinmalidir. Gercek backup path, retention schedule ve off-host transfer operasyonel runbook kapsamindadir; bu repository secret veya production dump saklamaz.

MS-018B operator modelinde backup production sunucusunda operator tarafindan tetiklenir. Source delivery yine Git-only kalir; backup artifact'i, SHA-256 kaydi ve off-host kopya Git disinda tutulur. Codex production SSH veya production backup komutu calistirmaz.

## Restore Verification

```powershell
npm run production:restore:verify -- --backup <temp-backup>
```

Verifier disposable PostgreSQL container baslatir, dump'i restore eder, beklenen alti canonical business table'i ve iki Prisma migration kaydini kontrol eder, sonra container'i siler. Production database overwrite etmez.

## Redis Siniri

Redis rate-limit/job scheduler runtime state tasir. Redis kaybi canonical business data kaybi degildir; PostgreSQL canonical state korunur. Redis backup MS-016 data-protection gate'i degildir.

## Rollback Preconditions

MS-016 schema/migration degistirmez. Compatible rollback onceki app image'a donusle sinirlidir. Gelecek incompatible migration iceren release icin verified PostgreSQL backup ve restore plan olmadan rollout yapilmaz.

MS-017 hazirlik tooling'i staging receipt icinde backup checksum ve restore verification alanlarini zorunlu kilar.

MS-017C approved staging drill sirasinda target alias `habersoft-rss-staging-alias` icin PostgreSQL custom-format backup alindi ve off-host disposable PostgreSQL restore verification passed oldu. Backup SHA-256 `595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc`. Restore verifier six canonical business table'i, two Prisma migration kaydini, sentinel row count minimumlarini, entry/detail invariant'ini, agent event varligini ve runtime status varligini kontrol etti. Backup/metadata Git'e alinmadi; production database overwrite edilmedi.

MS-017B2 local rehearsal tooling'i PostgreSQL backup ve disposable restore verification'i izole local Docker project uzerinde dener. Bu kanit production backup veya remote staging backup yerine gecmez.

## Production Evidence Status

MS-018C operator-confirmed production activation input'u production backup SHA-256 veya production off-host restore verification sonucu tasimaz.

- Production backup SHA-256: `NOT_RECORDED`
- Production off-host restore result: `NOT_RECORDED`

Bu durum production backup/restore'un failed oldugu anlamina gelmez; yalniz bu milestone'da kanit kaydedilmedigini belirtir. Backup komutu, restore verification veya production SSH bu gorevde calistirilmaz. Eksik production backup/restore evidence'i MS-019 operational evidence gap'i olarak kalir.
