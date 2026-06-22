# Staging Deployment and Rollback

## Sorumluluk

Bu belge MS-017 kapsaminda gercek staging deployment, target safety gate, immutable package/image identity, backup/restore verification, rollback ve roll-forward tatbikatinin secret-free operasyon gercegini aciklar.

## Durum

Remote staging preflight: `Passed`

Staging deployment: `Not executed`

Rollback drill: `Not executed`

MS-017B approved staging target read-only remote preflight, target alias `habersoft-rss-staging-alias` icin 2026-06-22 UTC tarihinde iki kez basariyla calistirildi. Strict SSH host identity operator-owned pinned known_hosts ile dogrulandi ve remote environment marker exact `staging` olarak ilk semantic gate'te verified edildi.

Remote host Linux `linux/amd64` olarak siniflandirildi; Docker Engine ve Docker Compose v2 noninteractive olarak available. Target project state `absent`, API port state `available`, base-dir state `existing-empty-approved`, filesystem state `read-write`, edge mode `loopback-only` / edge check `not_exercised`. Iki run icin before/after target-relevant inventory unchanged ve external preflight receipts + comparison verifier passed.

MS-017 remote staging deployment, package/image transfer, Docker resource mutation, rollback, roll-forward, production deployment, artifact publication, Git tag, GitHub Release, DNS/TLS/CyberPanel live change bu degisiklikte yapilmadi.

Application version remains: `0.1.0-ms-016`

Application status remains: `MVP Adayi - Deployment Karari Kesin / Release Paketi Dogrulandi`

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430` / `29`

## Hazirlanan Guvenlik Kapilari

MS-017 A asamasi yalniz local hazirlik ekler:

- `deploy/staging/target.example.json` staging target schema ornegi.
- `npm run staging:preflight` approved target icin strict SSH host identity, marker-first remote gate, read-only host/Docker/project/port/base-dir/disk preflight ve secret-free external receipt uretimi.
- `npm run staging:deploy`, `npm run staging:rollback`, `npm run staging:roll-forward` mutating aksiyonlari icin explicit target/env/package/confirmation guard'lari.
- `npm run staging:receipt:verify` secret-free receipt schema dogrulama.
- `npm run test:staging` target, SSH, remote layout, receipt ve rollback compatibility unit kontrolleri.

Mutating staging command'lari remote marker ve host identity preflight kaniti olmadan fail-fast olur. MS-017B preflight pass kaniti staging deployment basarisi sayilmaz; deployment MS-017C'ye kalir.

## Operator Input Preparation Kit

MS-017B1 asamasi gercek host veya secret uydurmadan, operator'un gerekli external girdileri repository disinda hazirlamasi icin local-only tooling ekler:

```powershell
npm run staging:inputs:scaffold -- --output-dir <external-empty-directory> --target-alias <staging-alias> --ssh-host <operator-host> --ssh-port 22 --ssh-user <operator-user> --known-hosts-file <external-known-hosts-path> --marker-path /etc/habersoft/environment --remote-base-dir <staging-base-dir> --project-name <staging-project> --api-port 13000 --edge-mode loopback-only
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input
npm run staging:known-hosts:inspect -- --target <external-path>/staging-target.json
```

Scaffold output'u:

```text
<external-output-dir>/
  staging-target.json
  staging.env
  staging-input-readiness.json
```

`staging-known-hosts` dosyasi tool tarafindan uretilmez. Operator, host owner'dan out-of-band dogruladigi fingerprint ile pinned known_hosts dosyasini kendisi hazirlar ve target descriptor icindeki path'e baglar.

Target descriptor scaffold'ta `approved=false` gelir. Operator dosyayi inceledikten ve known_hosts trust anchor'i hazirladiktan sonra `approved=true` yapmalidir; tool kendi olusturdugu target'i otomatik onaylamaz.

`--generate-staging-secrets` flag'i yalniz external `staging.env` dosyasina cryptographic random staging secret'lari yazar. Secret degerleri console'a, readiness receipt'e veya dokumana yazilmaz; existing `staging.env` uzerine secret generation yapilmaz.

`staging-input-readiness.json` local readiness receipt'tir; remote preflight receipt degildir. Bu receipt `host_key_trust_confirmed_by_tool=false`, `remote_environment_marker_verified=false`, `remote_contact_performed=false`, `remote_mutation_performed=false` ve `deployment_performed=false` alanlarini tasir.

`operator-input` mode image/package identity hazir olmadigini `image_identity_ready=false` olarak siniflandirabilir ve yine de read-only remote preflight icin input hazirligini dogrulayabilir. `deployment-ready` mode immutable digest-pinned `MAIN_SERVICE_IMAGE` ve existing production config/Compose verifier kapilarini ister.

Known_hosts inspect komutu offline calisir; `ssh-keyscan` kullanmaz, network'e cikmaz, dosyayi degistirmez ve fingerprint'i yalniz operator'un out-of-band karsilastirmasi icin gosterir.

MS-017B1 sonunda application version `0.1.0-ms-016` olarak kalir. Staging deployment, rollback, roll-forward, package/image transfer ve remote preflight bu asamada yapilmamistir.

## Local Rehearsal Ayrimi

MS-017B2 local isolated staging rehearsal passed. Bu akisin sahibi [local-staging-rehearsal.md](local-staging-rehearsal.md) dosyasidir.

Local rehearsal, canonical production package ve Compose kaynaklarini unique local Docker project altinda dry-run etti. Remote staging target, SSH, pinned known_hosts veya remote marker kullanmadi ve remote staging preflight/deployment basarisi sayilmaz.

## Host Provisioning Handoff

MS-017B3 staging host provisioning contract ve operator handoff bundle ekler. Bu akisin sahibi [staging-host-provisioning.md](staging-host-provisioning.md) dosyasidir.

Handoff bundle operator'a host prerequisite, SSH trust, marker, Docker/Compose, network/port, filesystem, capacity, package handoff ve local rehearsal evidence ayrimini verir. Bundle secret-free ve machine-verifiable'dir, fakat gercek target/env/known_hosts uretmez, remote host'a baglanmaz, marker yaratmaz, package/image transfer etmez ve staging deployment veya rollback kaniti sayilmaz.

## Target Descriptor

Tracked ornek:

```text
deploy/staging/target.example.json
```

Gercek target dosyasi repository disinda veya Git-ignored path'te tutulur:

```text
<external-path>/staging-target.json
```

Minimum sinirlar:

- `environment` exact `staging`.
- `approved` exact `true`.
- alias, project ve remote base directory `staging` icerir.
- host production hostname veya localhost olamaz.
- `known_hosts_file` readable olmalidir.
- remote marker path/value operator tarafindan onceden saglanir.
- base dir allowed staging prefix altinda absolute POSIX path'tir.
- API portu 1024..65535 araligindadir; 80/443 olamaz.
- `edge_mode` yalniz `loopback-only` veya `https`.
- target config secret field tasimaz.

## Remote Gate

Remote host'a ilk baglanti yalniz read-only preflight olmalidir. Codex environment marker'i yaratmaz, Docker kurmaz, firewall/DNS/TLS/CyberPanel degistirmez, user/group/reboot islemi yapmaz.

SSH options:

```text
BatchMode=yes
StrictHostKeyChecking=yes
UserKnownHostsFile=<known_hosts_file>
PasswordAuthentication=no
KbdInteractiveAuthentication=no
PreferredAuthentications=publickey
ForwardAgent=no
ClearAllForwardings=yes
RequestTTY=no
ConnectTimeout=10
ServerAliveInterval=10
ServerAliveCountMax=3
```

Host-key mismatch, missing marker veya marker mismatch blocker'dir.

## Receipt

MS-017B preflight receipts repository disinda olusturulur ve Git'e alinmaz. Sanitized doc summary yalniz target alias, UTC date, host-key/marker verification class, architecture, Docker/Compose readiness, project/port/base-dir/filesystem/capacity class, edge class, repeated-run result, inventory unchanged ve no-mutation flags tasir.

Gercek tatbikat sonunda raw `staging-deployment-receipt.json` Git'e alinmaz. Sanitized doc summary su alanlari tasimalidir:

- target alias only.
- deployed candidate version/commit.
- evidence commit.
- candidate/previous package checksums.
- candidate/previous image IDs.
- backup checksum.
- restore result.
- rollback and roll-forward result.
- final active staging version.
- safety flags all false for production/publication changes.

Receipt host/IP, username, known_hosts path, DB URL, JWT, Agent key, rate-limit secret, raw Docker env veya sentinel content tasimaz.

## Rerun Placeholders

```powershell
npm run staging:inputs:scaffold -- --output-dir <external-empty-directory> --target-alias <staging-alias> --ssh-host <operator-host> --ssh-port 22 --ssh-user <operator-user> --known-hosts-file <external-known-hosts-path> --marker-path /etc/habersoft/environment --remote-base-dir <staging-base-dir> --project-name <staging-project> --api-port 13000 --edge-mode loopback-only
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input
npm run staging:known-hosts:inspect -- --target <external-path>/staging-target.json
npm run staging:preflight -- --target $env:STAGING_TARGET_FILE --env-file $env:STAGING_ENV_FILE --receipt <external-preflight-run-1-receipt>
npm run staging:preflight -- --target $env:STAGING_TARGET_FILE --env-file $env:STAGING_ENV_FILE --receipt <external-preflight-run-2-receipt>
node scripts/staging-deployment.mjs receipt:compare --receipt-a <external-preflight-run-1-receipt> --receipt-b <external-preflight-run-2-receipt> --output <external-preflight-comparison-receipt>
npm run staging:deploy -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --package <candidate-package> --confirm-environment staging
npm run staging:rollback -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --package <previous-package> --confirm-release 0.1.0-ms-016
npm run staging:roll-forward -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --package <candidate-package> --confirm-release 0.1.0-ms-017
npm run staging:receipt:verify -- --receipt <receipt.json>
```

These commands require external target/env/package artifacts and do not embed secrets in repository files.

## Operator Inputs Needed

MS-017 completion requires:

- approved non-production staging target descriptor,
- pinned known_hosts file for the target,
- pre-created remote environment marker with exact `staging` value,
- external staging env file,
- previous and candidate image-included release packages,
- remote Docker/Compose availability through the deploy user.

MS-017B read-only target preflight is verified for target alias `habersoft-rss-staging-alias`. Staging deployment, rollback and roll-forward remain unverified until MS-017C executes with explicit candidate/previous package inputs and operator approval.
