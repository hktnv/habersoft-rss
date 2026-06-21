# Release Packaging

## Sorumluluk

Bu belge release package source, command, artifact inventory, manifest/checksum/SBOM/provenance, image identity, verifier, clean-room ve publication/deployment ayrimini aciklar.

Master baseline: `rss-habersoft-master-v12` / `def24246ee3fe2f3feabee35e3c658216899d343d21b32637622271bc74d8e50`.

## Komutlar

```powershell
npm run production:config:check -- --env-file <temp-production-env>
npm run production:compose:verify -- --env-file <temp-production-env>
npm run release:package -- --platform linux/amd64 --output <temp-release-dir>
npm run release:package:verify -- --package <temp-release-dir>
npm run test:release-packaging
```

Generated output temp dizinde tutulur ve commit edilmez.

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

SBOM CycloneDX biciminde package-lock kaynakli dependency inventory'sidir. Provenance local builder, git commit, platform ve publish/tag/deploy yapilmadigi bilgisini tasir. Bu belgeler external attestation veya registry publication iddiasi degildir.

## Checksum ve Tamper

`checksums.sha256` package dosyalarini kapsar. `release:package:verify` checksum mismatch, manifest mismatch, forbidden secret pattern veya forbidden file durumunda fail-fast olur. `test:release-packaging` manifest tamper negatif testini calistirir.

## Publication Ayrimi

MS-016 package uretir ve dogrular. External registry publish, Docker Hub/GHCR push, Git tag, GitHub Release ve production deployment yapmaz.
