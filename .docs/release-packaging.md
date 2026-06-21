# Release Packaging

## Sorumluluk

Bu belge release package source, command, artifact inventory, manifest/checksum/SBOM/provenance, image identity, verifier, clean-room ve publication/deployment ayrimini aciklar.

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`.

## Komutlar

```powershell
npm run production:config:check -- --env-file <temp-production-env>
npm run production:compose:verify -- --env-file <temp-production-env>
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
- `metadata/sbom.cdx.json`
- `metadata/provenance.json`
- `main-service-image.tar` when image inclusion is enabled

Manifest application/version/status, master release/hash, production deployment flag, publication flag, platform, image identity, service inventory, public route inventory and migration inventory tasir.

## Image Identity

Production Compose `MAIN_SERVICE_IMAGE` degerinin digest-pinned olmasini ister. Mutable `latest` reddedilir. Local package generation image inspect bilgisini manifest'e yazar; external registry push yapmaz.

## SBOM ve Provenance

SBOM `npm sbom --sbom-format=cyclonedx --json` ile uretilen gercek CycloneDX 1.5 JSON dokumanidir. Package verifier SBOM'un parse edilebilir olmasini, `main-service` / `0.1.0-ms-016` application component'ini, npm generator metadata'sini ve bos olmayan component inventory'sini zorunlu kilar.

Provenance seviyesi `local metadata` ve attestation seviyesi `unsigned provenance` olarak sinirlidir. Provenance source commit, canonical master release/hash/count, platform, image identity, SBOM summary ve publish/tag/deploy yapilmadigi bilgisini tasir. BuildKit attestation, signed attestation, external registry publication veya GitHub Release iddiasi degildir; verifier bu false claim'leri reddeder.

## Checksum ve Tamper

`checksums.sha256` package dosyalarini kapsar. `release:package:verify` checksum mismatch, manifest mismatch, wrong master hash/count, wrong source commit, malformed SBOM, false attestation claim, missing required image artifact, forbidden secret pattern veya forbidden file durumunda fail-fast olur. `test:release-packaging` bu negatif kapilari calistirir.

Default verifier staging-handoff icin `main-service-image.tar` ister. Hizli local no-image testi yalniz `--allow-no-image true` ile gecirilir ve staging-handoff kaniti sayilmaz.

MS-017 hazirlik tooling'i staging target ve receipt kapilarini ekler; remote staging deployment yalniz onayli target, pinned host key, remote marker ve external staging env saglandiginda baslatilabilir. Bkz. [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md).

MS-017B2 local rehearsal tooling'i previous ve candidate image-included package'leri izole local Docker project altinda kullanir. Application version ayni kalabilir; rollback identity source commit ve image ID ile ayrilir. Bkz. [local-staging-rehearsal.md](local-staging-rehearsal.md).

## Publication Ayrimi

MS-016 package uretir ve dogrular. External registry publish, Docker Hub/GHCR push, Git tag, GitHub Release ve production deployment yapmaz.
