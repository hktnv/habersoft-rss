# Backup and Restore

## Sorumluluk

Bu belge production PostgreSQL backup prerequisite'ini, backup artifact/metadata/checksum'ini, disposable restore verification'i, Redis reconstructability sinirini ve rollback oncesi data-protection gate'ini aciklar.

## Backup

Backup custom-format `pg_dump -Fc` artifact'idir. Script:

```powershell
npm run production:backup -- --compose-file <compose-file> --env-file <env-file> --output <temp-backup>
```

Script backup dump ile birlikte `<temp-backup>.metadata.json` uretir. Metadata checksum, format, database adi ve timestamp tasir; password yazmaz.

Backup output production host disina tasinmalidir. Gercek backup path, retention schedule ve off-host transfer operasyonel runbook kapsamindadir; bu repository secret veya production dump saklamaz.

## Restore Verification

```powershell
npm run production:restore:verify -- --backup <temp-backup>
```

Verifier disposable PostgreSQL container baslatir, dump'i restore eder, beklenen alti canonical business table'i ve iki Prisma migration kaydini kontrol eder, sonra container'i siler. Production database overwrite etmez.

## Redis Siniri

Redis rate-limit/job scheduler runtime state tasir. Redis kaybi canonical business data kaybi degildir; PostgreSQL canonical state korunur. Redis backup MS-016 data-protection gate'i degildir.

## Rollback Preconditions

MS-016 schema/migration degistirmez. Compatible rollback onceki app image'a donusle sinirlidir. Gelecek incompatible migration iceren release icin verified PostgreSQL backup ve restore plan olmadan rollout yapilmaz.

MS-017 hazirlik tooling'i staging receipt icinde backup checksum ve restore verification alanlarini zorunlu kilar. Gercek staging backup/restore bu degisiklikte yapilmamistir; onayli staging target ve external staging env gereklidir.

MS-017B2 local rehearsal tooling'i PostgreSQL backup ve disposable restore verification'i izole local Docker project uzerinde dener. Bu kanit production backup veya remote staging backup yerine gecmez.
