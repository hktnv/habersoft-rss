# Release Packaging

## Sorumluluk

Bu belge release package source, command, artifact inventory, manifest/checksum/SBOM/provenance, image identity, verifier, clean-room ve publication/deployment ayrimini aciklar.

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`.

## Komutlar

```powershell
npm run production:config:check -- --env-file <shared-env> --runtime-image-env <release-dir>/deploy/runtime-image.env
npm run production:compose:verify -- --env-file <shared-env> --runtime-image-env <release-dir>/deploy/runtime-image.env
npm run release:package -- --platform linux/amd64 --output <temp-release-dir>
npm run release:package:verify -- --package <temp-release-dir>
npm run test:release-packaging
npm run master:baseline:verify
```

Generated output temp dizinde tutulur ve commit edilmez.
Staging-handoff paketi icin `release:package` app repository Git tree'sinin temiz olmasini ister; `--allow-dirty true` yalniz hizli local negatif testlerde kullanilir.

## Artifact Inventory

Package su dosyalari uretir:

- `manifest.json`
- `checksums.sha256`
- `deploy/production/compose.yaml`
- `deploy/production/production.env.template`
- `deploy/runtime-image.env` when image inclusion is enabled
- `metadata/sbom.cdx.json`
- `metadata/provenance.json`
- `main-service-image.tar` when image inclusion is enabled

Manifest application/version/status, master release/hash, production deployment flag, publication flag, platform, image identity, runtime image env metadata, service inventory, public route inventory and migration inventory tasir.

## Image Identity

`MAIN_SERVICE_IMAGE` shared production/staging env sahibi degildir. Image identity release package tarafindan uretilir: `main-service-image.tar` load/inspect sonucundaki `sha256:<image-id>` degeri `deploy/runtime-image.env` icine yazilir ve manifest/provenance/checksum tarafindan baglanir.

MS-018B production operator modeli, production icin ayni immutable image prensibini Git-only source delivery ile uygular: operator `origin/main` commit'ini sunucuda `git pull --ff-only` ile alir, image'i server-local Docker build ile exact commit label'iyle uretir ve `deploy/runtime-image.env` dosyasini build edilen image ID'den olusturur. Staging package-derived image modeli staging evidence icin devam eder; production kaydi Git commit + server-built immutable image ID uzerinden tutulur.

Production Compose iki env dosyasi ile resolve edilir:

```powershell
docker compose --env-file <shared-env> --env-file <release-dir>/runtime-image.env -f <compose-file> config
```

Shared env config ve secret inventory'sini tasir; `MAIN_SERVICE_IMAGE` icermez. Runtime image env yalniz `MAIN_SERVICE_IMAGE=sha256:<verified-loaded-image-id>` satirini tasir. Mutable `latest`, master documentation hash'i, eksik runtime image env veya package manifest/provenance/runtime env uyumsuzlugu verifier tarafindan reddedilir. Local package generation image inspect bilgisini manifest'e yazar; external registry push yapmaz.

## SBOM ve Provenance

SBOM `npm sbom --sbom-format=cyclonedx --json` ile uretilen gercek CycloneDX 1.5 JSON dokumanidir. Package verifier SBOM'un parse edilebilir olmasini, `main-service` / `0.1.0-ms-017` application component'ini, npm generator metadata'sini ve bos olmayan component inventory'sini zorunlu kilar.

Provenance seviyesi `local metadata` ve attestation seviyesi `unsigned provenance` olarak sinirlidir. Provenance source commit, canonical master release/hash/count, platform, image identity, SBOM summary ve publish/tag/deploy yapilmadigi bilgisini tasir. BuildKit attestation, signed attestation, external registry publication veya GitHub Release iddiasi degildir; verifier bu false claim'leri reddeder.

## Checksum ve Tamper

`checksums.sha256` package dosyalarini kapsar. `release:package:verify` checksum mismatch, manifest mismatch, wrong master hash/count, wrong source commit, malformed SBOM, false attestation claim, missing required image artifact, runtime image env eksigi/uyumsuzlugu, forbidden secret pattern veya forbidden file durumunda fail-fast olur. `test:release-packaging` bu negatif kapilari calistirir.

Default verifier staging-handoff icin `main-service-image.tar` ister. Hizli local no-image testi yalniz `--allow-no-image true` ile gecirilir ve staging-handoff kaniti sayilmaz.

MS-017C1A-R2 image identity gate'i package-owned runtime image env modeliyle gecti. Commit `074d868d09c5b3d6079803480760d9e669b51826` icin candidate package, loaded image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ve runtime env checksum `b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873` ile local ve remote config-only proof'tan gecti. Remote proof app stack baslatmadi, migration/readiness retry yapmadi ve artifact publish etmedi. Bkz. [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md).

MS-017C full staging drill, ayni candidate package'i SHA-256 `b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082` ve image ID `sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919` ile remote loaded image olarak dogruladi. Previous rollback package `0.1.0-ms-016` source `9bed749e531fdbe435011b3948ec52982387269e`, package SHA-256 `fe68dd586c9c0efe105de110fee00acb6a71adb087da45a63fdc51ed32dafd0b` ve image ID `sha256:4badab61265f0545ce945098220068238e05b1f7fda008fd1f853d75858a5b42` ile dogrulandi. Drill artifact publication, external registry push, Git tag veya GitHub Release olusturmadi.

MS-017B2 local rehearsal tooling'i previous ve candidate image-included package'leri izole local Docker project altinda kullanir. Application version ayni kalabilir; rollback identity source commit ve image ID ile ayrilir. Bkz. [local-staging-rehearsal.md](local-staging-rehearsal.md).

MS-017B3 operator handoff bundle package uretmez veya image tasimaz; yalniz staging host prerequisite ve package handoff requirement'larini secret-free sozlesme olarak verir. Bkz. [staging-host-provisioning.md](staging-host-provisioning.md).

## Publication Ayrimi

MS-017 package uretir, dogrular ve approved staging drill icinde kullanabilir. External registry publish, Docker Hub/GHCR push, Git tag, GitHub Release ve production deployment yapmaz.
