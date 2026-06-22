# Staging Deployment and Rollback

## Sorumluluk

Bu belge MS-017 kapsaminda gercek staging deployment, target safety gate, immutable package/image identity, backup/restore verification, rollback ve roll-forward tatbikatinin secret-free operasyon gercegini aciklar.

## Durum

Remote staging preflight: `Passed`

First candidate staging attempt: `Failed at tenant JWKS readiness`

Package-derived image binding: `Passed`

Production IdP readiness-only proof: `Passed`

Staging deployment acceptance: `Passed`

Rollback drill: `Passed`

Roll-forward drill: `Passed`

MS-017B approved staging target read-only remote preflight, target alias `habersoft-rss-staging-alias` icin 2026-06-22 UTC tarihinde iki kez basariyla calistirildi. Strict SSH host identity operator-owned pinned known_hosts ile dogrulandi ve remote environment marker exact `staging` olarak ilk semantic gate'te verified edildi.

MS-017C ilk candidate attempt, version `0.1.0-ms-017` icin migrate exit 0, `GET /health/live` 200, `GET /health/ready` 503 sonucuyla kontrollu durdu. Readiness failure secret-free olarak `tenantAuth=down / JWKS unavailable` siniflandirildi; worker health passed. Sentinel yazilmadi, backup alinmadi, rollback/roll-forward denenmedi, `current` symlink candidate'a promote edilmedi, production'a dokunulmadi ve artifact publication yapilmadi.

MS-017C1 root cause: `OPERATOR_JWKS_CONFIG_INVALID`. Operator-provided JWKS config HTTPS ve canonical path tasiyordu, fakat hostname class `external-noncanonical` idi. Ayni configured endpoint local makinede, remote host namespace'te, candidate image default bridge aginda ve temporary target-project network probe'unda DNS failure verdi. Canonical auth JWKS endpoint ayni katmanlarin tamaminda HTTPS, TLS/CA, JSON parse ve RS256 signing key shape kontrollerinden gecti.

MS-017C1 remote failed-state recheck: marker verified, project containers `0`, running containers `0`, API port `available`, project volumes `2`, release layout present, candidate/previous release dirs identifiable, `current` symlink absent/not promoted ve active healthy version absent. Temporary no-secret target-project network probe'u sonrasinda project network inventory before/after restored.

MS-017C1A staging IdP decision gate: `auth-staging.habersoft.com` icin operator tarafindan gosterilen JWKS kaniti yalniz HTTP port 3000 upstream'in `{ "keys": [...] }` biciminde RS256 public JWKS sundugunu kanitlar. Local operator network bu hostu cozemedi; approved remote host HTTP port 3000 uzerinden valid JWKS gordu; HTTPS explicit port TLS handshake failed, HTTPS edge 443 unavailable ve candidate image default network `auth-staging` DNS'ini cozemedi. Canonical production IdP `https://auth.habersoft.com/.well-known/jwks.json` local, remote host ve candidate image tarafinda HTTPS/JWKS shape kontrollerinden gecti.

MS-017C1A decision outcome: `AUTH_STAGING_HTTP_UPSTREAM_ONLY`. Staging issuer/audience/scope/token-acquisition contract bulunmadi; HTTPS edge ve staging IdP ownership operator/auth-service tarafinda pending. Bu task staging env rewrite, secret rotation, app project start, migration, sentinel, backup/restore, rollback/roll-forward veya current symlink promotion yapmadi.

MS-017C1A-R credential rotation gate: rotated external staging credential set no-disclosure denylist proof'tan gecti. Local ve remote canonical env kontrolleri DB credential component'i, tenant rate-limit HMAC secret'i ve Agent key icin onceki compromised degerlerin artik bulunmadigini; `POSTGRES_PASSWORD` ile `DATABASE_URL` password component'inin tutarli oldugunu dogruladi. Canonical release env atomik olarak yenilendi ve mode `0600` olarak dogrulandi. Preserved PostgreSQL volume, yalniz `postgres` servisi gecici baslatilarak rotated role credential ile TCP auth uzerinden read-only `select 1` kanitini verdi; API, worker ve Redis baslatilmadi. Migration, sentinel, backup, rollback, roll-forward, `current` symlink promotion, production deployment veya artifact publication yapilmadi.

MS-017C1A-R input-integrity sonucu: rotated staging credential set dogrulandi, fakat `MAIN_SERVICE_IMAGE` halen shared staging env icinde operator-managed input olarak kaldigi icin image identity gate'i kapanmamisti. Staging IdP/JWKS karari degismedi: `AUTH_STAGING_HTTP_UPSTREAM_ONLY`; HTTPS JWKS edge ve authoritative staging IdP contract eksik oldugu icin remote readiness retry ve full staging deployment yapilmadi.

MS-017C1A-R2 package image-binding sonucu: `MAIN_SERVICE_IMAGE` shared `staging.env` sahibi olmaktan cikarildi. Candidate package `074d868d09c5b3d6079803480760d9e669b51826` kaynagindan uretildi, `deploy/runtime-image.env` package artifact'i olarak dogrulandi ve remote host'ta loaded image ID ile birebir eslesti. Remote shared env atomik olarak yenilendi ve `MAIN_SERVICE_IMAGE` icermedigi dogrulandi; release-local `runtime-image.env` dosyalari previous/candidate image ID'lerinden uretildi. Compose config resolution sirasi `previous -> candidate -> previous -> candidate` olarak iki env dosyasi ile gecti. API/worker/PostgreSQL/Redis baslatilmadi, migration/readiness retry/sentinel/backup/rollback/roll-forward/current symlink promotion yapilmadi.

MS-017C1A-3V contract-pinned validator sonucu: authoritative external staging authorization contract accepted durumundadir ve decision exact `STAGING_USES_PRODUCTION_IDP` olarak pinlenmistir. `scripts/staging/env-inputs.mjs`, yalniz `TENANT_AUTH_JWKS_URL=https://auth.habersoft.com/.well-known/jwks.json` alanina, `deploy/staging/idp-contract-policy.json` projection'i ile hash/field-verified external contract saglandiginda izin verir. Bu genel production identifier bypass'i degildir; `auth-staging.habersoft.com`, HTTP/local fixture ve diger alanlardaki production identifier'lar rejected kalir. Real `staging.env` mutate edilmedi, remote readiness proof calistirilmadi ve application auth runtime degismedi.

MS-017C1A-3R production IdP readiness-only sonucu: active staging IdP decision `STAGING_USES_PRODUCTION_IDP` olarak kaldi ve selected IdP `https://auth.habersoft.com` oldu. Canonical production JWKS `https://auth.habersoft.com/.well-known/jwks.json` local host, remote host, candidate image default bridge network ve candidate image target project network katmanlarinda strict HTTPS/JWKS shape proof'tan gecti. Candidate identity source commit `074d868d09c5b3d6079803480760d9e669b51826`, package SHA-256 `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`, image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ve runtime-image.env SHA-256 `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873` ile dogrulandi. Remote shared staging env atomik olarak yenilendi, mode `0600` dogrulandi ve `MAIN_SERVICE_IMAGE` shared env icinde bulunmadi. Preserved PostgreSQL/Redis volumes uzerinde PostgreSQL, Redis, migrate current/no-op, API ve worker gecici olarak baslatildi; `/health/live` ve `/health/ready` iki tur 200 dondu ve readiness govdesinde `tenantAuth=up`, `postgres=up`, `redis=up` kanitlandi. Worker tenant-auth/JWKS lifecycle baslatmadi, scheduler/worker health dogrulandi ve non-mutating auth boundary smoke `404/401/401` ile gecti. Sentinel yazilmadi, backup/restore yapilmadi, rollback/roll-forward denenmedi, `current` symlink promote edilmedi, full staging deployment kabul edilmedi, production deployment ve artifact publication yapilmadi. Final active staging service `none`, running project container `0`, API listener `0` ve volumes preserved olarak kapandi.

Application version remains: `0.1.0-ms-017`

Application status: `MVP Adayi - Staging Dogrulandi / Rollback Tatbikati Gecti`

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430` / `29`

## MS-017C Full Drill Result

2026-06-22 UTC tarihinde target alias `habersoft-rss-staging-alias` uzerinde full staging deployment, backup/restore, rollback ve roll-forward drill passed.

Strict preflight:

- architecture `linux/amd64`
- Docker and Compose v2 available
- project `existing-approved-staging`
- running project containers `0`
- API listener `0`
- project volumes `2`
- filesystem `read-write`
- inventory unchanged
- edge mode `loopback-only`

Candidate identity:

- version `0.1.0-ms-017`
- source commit `074d868d09c5b3d6079803480760d9e669b51826`
- package SHA-256 `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082`
- image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919`
- runtime-image.env SHA-256 `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873`

Previous rollback identity:

- version `0.1.0-ms-016`
- source commit `9bed749e531fdbe435011b3948ec52982387269e`
- package SHA-256 `fe68dd586c9c0efe105de110fee00acb6a71adb087da45a63fdc51ed32dafd0b`
- image ID `sha256:4badab61265f0545ce945098220068238e05b1f7fda008fd1f853d75858a5b42`
- generated runtime-image.env SHA-256 `d9885d838af2a02aabd32ea11a7703b05b4da44b55e5add6c88d7141a4dea296`

Acceptance evidence:

- candidate first deploy passed with two readiness rounds
- worker scheduler `cleanup.daily` verified
- synthetic sentinel verified with alias SHA-256 `89024679ad934d5cfa85e401c365b686c49542b712f9fd06d26f3fdbac47ff92`
- sentinel expected counts: feeds `1`, site_feeds `1`, entries `1`, entry_details `1`, agent_feed_check_events `1`, agent_runtime_status `1`
- staging PostgreSQL custom-format backup SHA-256 `595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc`
- off-host restore verification passed
- rollback to `0.1.0-ms-016` passed with two readiness rounds and sentinel preserved
- roll-forward to `0.1.0-ms-017` passed with two readiness rounds and sentinel preserved
- final active version `0.1.0-ms-017`
- final current pointer `candidate`
- final previous pointer `0.1.0-ms-016`
- final services remain running
- API loopback-only; PostgreSQL, Redis and worker have no public host ports

Safety flags:

- production touched: `false`
- artifact published: `false`
- external registry publish: `false`
- Git tag created: `false`
- GitHub Release created: `false`
- DNS/TLS/CyberPanel live change: `false`

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
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input --idp-contract <external-staging-idp-contract.md>
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

`operator-input` mode image/package identity'nin shared env tarafindan secilmedigini `image_identity_ready=false` olarak siniflandirir ve read-only remote preflight icin input hazirligini dogrulayabilir. `deployment-ready` mode shared env yaninda verified package `deploy/runtime-image.env` dosyasini `--runtime-image-env` ile ister; shared env icinde `MAIN_SERVICE_IMAGE` bulunursa fail-fast olur.

Staging env canonical production IdP JWKS kullanacaksa `--idp-contract <external-staging-idp-contract.md>` zorunludur. Tool explicit CLI path'i veya `STAGING_IDP_CONTRACT_FILE` pointer'ini okur; dosya repository'ye kopyalanmaz, receipt'e path veya raw Markdown yazilmaz. Receipt yalniz safe contract projection alanlarini, raw/normalized SHA-256 match sonucunu ve no-remote/no-mutation flag'lerini tasir.

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
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode operator-input --idp-contract <external-staging-idp-contract.md>
npm run staging:inputs:verify -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --mode deployment-ready --runtime-image-env <candidate-package>/deploy/runtime-image.env --idp-contract <external-staging-idp-contract.md>
npm run staging:known-hosts:inspect -- --target <external-path>/staging-target.json
npm run staging:preflight -- --target $env:STAGING_TARGET_FILE --env-file $env:STAGING_ENV_FILE --idp-contract $env:STAGING_IDP_CONTRACT_FILE --receipt <external-preflight-run-1-receipt>
npm run staging:preflight -- --target $env:STAGING_TARGET_FILE --env-file $env:STAGING_ENV_FILE --idp-contract $env:STAGING_IDP_CONTRACT_FILE --receipt <external-preflight-run-2-receipt>
node scripts/staging-deployment.mjs receipt:compare --receipt-a <external-preflight-run-1-receipt> --receipt-b <external-preflight-run-2-receipt> --output <external-preflight-comparison-receipt>
npm run staging:production-idp-readiness -- --target $env:STAGING_TARGET_FILE --env-file $env:STAGING_ENV_FILE --candidate-package <candidate-package> --candidate-package-sha256 <candidate-package-sha256> --preflight-receipt <external-preflight-receipt> --idp-contract $env:STAGING_IDP_CONTRACT_FILE --receipt <external-readiness-receipt>
npm run staging:deploy -- --target <external-path>/staging-target.json --env-file <external-path>/staging.env --package <candidate-package> --idp-contract <external-staging-idp-contract.md> --confirm-environment staging
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
- external staging env file without `MAIN_SERVICE_IMAGE`,
- external staging IdP authorization contract when the shared env selects canonical production JWKS,
- previous and candidate image-included release packages,
- candidate package `deploy/runtime-image.env`,
- remote Docker/Compose availability through the deploy user.

MS-017B read-only target preflight is verified for target alias `habersoft-rss-staging-alias`. MS-017C1A-R2 package/image binding is verified. MS-017C1A-3R production IdP readiness-only proof is passed with canonical production JWKS. MS-017C full staging deployment, backup/restore, rollback and roll-forward drill is now passed with explicit candidate/previous package inputs. Production deployment, artifact publication, Git tag and GitHub Release remain unperformed.
