# Staging Host Provisioning

## Sorumluluk

Bu belge remote staging preflight ve deployment oncesinde hosting/operator tarafindan hazirlanmasi gereken non-production host, SSH trust, marker, Docker/Compose, network, port, filesystem, capacity ve handoff bundle kosullarini aciklar.

Degisim nedeni yalniz staging host prerequisite'leri, operator sorumlulugu, handoff artifact modeli veya preflight'a teslim edilen external input contract'i degistiginde vardir.

## Durum

Local isolated staging rehearsal: `Passed`

Remote staging preflight: `Not executed`

Remote staging deployment: `Not executed`

Production deployment: `Not executed`

Application version: `0.1.0-ms-016`

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430` / `29`

## Sahiplik Siniri

- Target descriptor sahibi: `scripts/staging/target-config.mjs` ve `staging:inputs:*`.
- Staging env inventory sahibi: `scripts/staging/env-inputs.mjs` ve production env template.
- Pinned known_hosts offline inspect sahibi: `scripts/staging/known-hosts.mjs`.
- Local rehearsal evidence sahibi: [local-staging-rehearsal.md](local-staging-rehearsal.md).
- Remote staging deployment evidence sahibi: [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md).
- Host provisioning handoff sahibi: bu belge, `deploy/staging/*handoff*`, `scripts/staging-operator-handoff.mjs` ve `test:staging:handoff`.

Handoff bundle yeni canonical target/env sahibi olmaz, release package'i yeniden tanimlamaz ve deployment runbook'unu kopyalamaz.

## Official Source Check

MS-017B3 talimatlari yazilmadan once su primary/current kaynaklar kontrol edildi:

- OpenSSH known_hosts lookup, ssh-keygen fingerprint inspection ve SSH client option semantics.
- Docker Engine ve Docker Compose v2 command/help modeli.
- Docker Compose service port publishing, project network ve named volume davranisi.
- PostgreSQL pg_dump custom-format backup ve pg_restore verification prerequisite'leri.

Bu repository vendor-specific CyberPanel live talimati, cloud SDK veya configuration-management framework eklemez.

## Host Requirements

Generated `host-requirements.json` su non-secret sozlesmeyi tasir:

- `environment=staging`.
- `application=main-service`.
- `application_version=0.1.0-ms-016`.
- master release/hash/count exact v12.
- `required_platform=linux/amd64`.
- Linux host.
- Docker Engine required.
- Docker Compose v2 required.
- noninteractive Docker access required.
- SSH BatchMode required.
- pinned known_hosts required.
- remote marker required with exact value `staging`.
- production Compose service count `5`.
- API binding `loopback-only`.
- PostgreSQL, Redis and worker public ports disallowed.
- PostgreSQL and Redis persistent named volumes required.
- off-host PostgreSQL backup required before rollout.
- resource limits `site-specific-after-benchmark`.
- remote preflight required.
- remote deployment performed false.

CPU/RAM, replica count veya HA iddiasi uydurulmaz. Operator installed version ve host kapasitesini read-only preflight ve site benchmark verisiyle dogrular.

## Capacity Model

Capacity sizing su olcumler gelmeden tamamlanmis sayilmaz:

- active feed count.
- target poll interval seconds.
- peak Agent entry batches per minute.
- peak Tenant API requests per minute.
- PostgreSQL data growth per day.
- Redis job/rate-limit memory footprint.
- backup window minutes.

Formula family:

```text
feed_poll_budget_per_minute = active_feed_count * 60 / target_poll_interval_seconds
agent_batch_write_budget_per_minute = peak_agent_entry_batches_per_minute * max_entries_per_batch
postgresql_storage_floor = current_database_size + retained_entry_growth + backup_restore_headroom
rollback_window_capacity = candidate_package_size + previous_package_size + off_host_backup_size + restore_scratch_space
```

Bu staging fazi single-host failure domain kabulune dayanir. HA claim yoktur.

## Network and Ports

Production Compose topology degismez:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

API yalniz loopback-only edge contract'i ile host portuna yayinlanir. PostgreSQL, Redis ve worker host port yayinlamaz. Public DB/Redis/worker exposure blocker'dir.

## SSH Trust Handoff

Handoff bundle known_hosts uretmez ve host key icermez.

Operator:

1. Host owner'dan fingerprint veya public host key bilgisini trusted out-of-band kanal ile alir.
2. Pinned known_hosts dosyasini repository disinda olusturur.
3. Offline inspect yapar:

```powershell
ssh-keygen -F <operator-staging-host> -f <external-pinned-known-hosts-file>
ssh-keygen -l -E sha256 -f <operator-host-public-key-file>
npm run staging:known-hosts:inspect -- --target <external-staging-target-file>
```

Host-key mismatch, missing entry veya strict checking disi bir ayar blocker'dir.

## Environment Marker Handoff

Operator remote marker'i preflight oncesinde pre-create eder. Bu repository marker yaratmaz.

Marker value exact:

```text
staging
```

Marker path external target descriptor icinde operator tarafindan belirlenir. Missing marker, symlink marker veya value mismatch read-only remote preflight blocker'dir.

## Bundle Commands

Generate:

```powershell
npm run staging:handoff:generate -- --output-dir <external-empty-directory> --platform linux/amd64 --edge-mode loopback-only --marker-path <operator-marker-path> --remote-base-dir <operator-staging-base-dir> --project-name <staging-project> --api-port <staging-api-port>
```

Verify:

```powershell
npm run staging:handoff:verify -- --bundle <external-output-directory>
```

Output directory repository disinda olmalidir. Existing non-empty output explicit overwrite olmadan fail eder. Generated bundle Git'e alinmaz.

## Bundle Inventory

```text
handoff-manifest.json
host-requirements.json
operator-checklist.md
staging-target.template.json
staging.env.template
known-hosts-instructions.md
environment-marker-instructions.md
package-handoff-requirements.json
local-rehearsal-evidence.json
checksums.sha256
```

Bundle secret, real host/IP/user/local path, real known_hosts key, staging credential, deployable package veya image artifact tasimaz.

## Target and Env Templates

`staging-target.template.json` `approved=false` gelir. Operator target'i review ettikten, pinned known_hosts dosyasini hazirladiktan ve marker sozlesmesini dogruladiktan sonra external real target dosyasinda `approved=true` yapar.

`staging.env.template` placeholder-only inventory'dir. Gercek staging secret'lari repository disinda doldurulur veya `staging:inputs:scaffold` external dosya uzerinden kullanilir. Template deployable image secmez.

## Package Handoff

Handoff bundle release package uretmez, image transfer etmez ve external registry publish yapmaz. Candidate package gerektigi nokta remote read-only preflight'tan sonraki bounded deployment hazirligidir.

Package identity sahibi [release-packaging.md](release-packaging.md) belgesidir. Handoff bundle yalniz operator'a hangi package verifier kapilarinin gerekli oldugunu soyler.

## Local Rehearsal Evidence

`local-rehearsal-evidence.json`, [local-staging-rehearsal.md](local-staging-rehearsal.md) dosyasindan uretilir ve local-only gercegi tasir:

- local rehearsal passed.
- backup/restore passed.
- rollback and roll-forward passed.
- remote staging contact false.
- remote staging deployment false.
- production deployment false.
- artifact publication false.

Bu kanit remote staging preflight veya remote staging deployment kaniti degildir.

## Verification and Redaction

`staging:handoff:verify` su kapilari fail-fast uygular:

- exact bundle file inventory.
- manifest payload hashes.
- `checksums.sha256` tamper check.
- host requirements identity and safety flags.
- target template `approved=false`.
- env template placeholder-only secret fields.
- local rehearsal evidence doc alignment.
- private key, bearer token, JWT, cloud key and database credential scan.
- known_hosts key line rejection.
- production host/IP pattern rejection.
- local path pattern rejection.
- remote deployment and mutation flags false.
- package/image archive injection rejection.
- path traversal rejection.

## Operator Checklist

Generated `operator-checklist.md` exact mandatory operator steps'i tasir:

1. generate handoff bundle
2. hosting/operator reviews host requirements
3. provision non-production host
4. pre-create staging marker
5. verify fingerprint out-of-band and create pinned known_hosts
6. scaffold target/env externally
7. set approved=true only after review
8. fill/generate staging secrets
9. local inputs verify
10. known_hosts offline inspect
11. provide STAGING_TARGET_FILE and STAGING_ENV_FILE

## Next Step

MS-017B - Approved staging target read-only remote preflight.
