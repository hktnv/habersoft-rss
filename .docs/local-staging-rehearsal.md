# Local Staging Rehearsal

## Sorumluluk

Bu belge canonical production package ve Compose kaynaklarinin izole local Docker ortaminda candidate deployment, PostgreSQL backup/restore, immutable-image rollback ve roll-forward dry-run davranisini aciklar.

## Durum

Status: `Passed`

Local isolated staging rehearsal exact MS-016A previous package ve exact MS-017B2 Commit A candidate package ile tamamlandi. Bu durum remote staging preflight veya remote staging deployment basarisi degildir.

Local isolated staging rehearsal: Passed

Remote staging preflight: Not executed

Remote staging deployment: Not executed

Application version: 0.1.0-ms-016

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430` / `29`

## Evidence Ozeti

Runtime candidate source commit: `b992e77353aef6138afef19620a9d38835f93266`

Previous source commit: `9bed749e531fdbe435011b3948ec52982387269e`

Previous package SHA-256: `b5602ef5fc4cafb2746454cd4043956ad63ed6109e3e0e157a865c6886c775d9`

Candidate package SHA-256: `b4b34e1614de8dd18a4d6a08b28e19965546cc0b4f8c399ac757d7f37b9948c8`

Previous image ID: `sha256:cb1f9ac8c63c1d78512423d4837adf34d1dd453eaa73a31d23218c63b6ca01d8`

Candidate image ID: `sha256:2ee7a5fba06cd8ca241eb4196595eb873b441a2a3fadc4e10dd8165b8a06fb7e`

Backup SHA-256: `32f02e02b37ba079e7b2633fa02e3128eb10b1d1d9fa0de5a9f33cb568d1f491`

Tenant auth rehearsal mode: `external-https-jwks-readiness-only`

Local rehearsal project name: `main-service-ms017b2-761600552c67`

Receipt verification: `Passed`

Restore verification: `Passed`

Rollback dry-run: `Passed`

Roll-forward: `Passed`

Teardown verification: `Passed`

Scheduler verification: `Passed`

## Kapsam

Rehearsal yalniz tek makinede unique Docker Compose project name ile calisir. Canonical production Compose dosyasini kullanir, fakat production host, remote staging host, SSH, DNS/TLS/CyberPanel, external registry veya Git release mekanizmasina dokunmaz.

Iki package kullanilir:

- previous package: MS-016A source commit.
- candidate package: rehearsal tooling commit.

Iki package'in application version degeri ayni kalir. Ayrim source commit ve immutable Docker image ID ile yapilir; bu nedenle bu islem version rollback degil, immutable image/source rollback rehearsal olarak adlandirilir.

## Komutlar

```powershell
npm run staging:rehearsal:local -- --previous-commit <previous-commit> --candidate-commit <candidate-commit> --platform linux/amd64 --output-root <external-temp-dir>
npm run staging:rehearsal:verify -- --receipt <external-temp-dir>/receipt/local-staging-rehearsal-receipt.json
npm run test:staging:rehearsal
```

`output-root` repository disinda olmalidir. Generated package, env, backup ve receipt dosyalari Git'e alinmaz.

## Sentetik Config ve Auth Mode

Rehearsal production-mode container davranisini korur. Tenant auth readiness icin HTTPS JWKS endpoint kullanilir ve bu mod receipt'te `external-https-jwks-readiness-only` olarak siniflandirilir. Local HTTP JWKS fixture production-mode iddiasi altinda kullanilmaz.

Sentinel data Agent heartbeat route'u ve `agent_runtime_status` PostgreSQL satiri ile kanitlanir. Agent key ve database password secret degerleri console'a, receipt'e veya dokumana yazilmaz.

## Docker Izolasyonu

Rehearsal project name `main-service-ms017b2-*` prefix'i ile sinirlidir. Teardown yalniz bu project'e ait container, network ve named volume kaynaklarini `docker compose down -v --remove-orphans` ile temizler. Global Docker prune, unscoped volume/network/container delete veya local dev project mutation yapilmaz.

Production Compose service inventory exact:

```text
postgres
redis
migrate
main-service-api
main-service-worker
```

API yalniz loopback host portuna acilir. PostgreSQL, Redis ve worker host port yayinlamaz.

## Receipt

External `local-staging-rehearsal-receipt.json` secret-free olarak verify edildi ve su gercekleri tasir:

- previous/candidate source commit.
- previous/candidate package checksum.
- previous/candidate image ID.
- master release/hash/count.
- tenant auth rehearsal mode.
- backup checksum.
- restore, rollback, roll-forward and teardown result.
- remote staging, production deployment and publication flags all false.

Raw temp path, secret, DB URL, Agent key, JWT, host/IP veya raw sentinel payload receipt'e yazilmaz.

## Sonraki Adim

Local rehearsal pass etse bile remote staging preflight hala ayridir ve operator-provided approved target, env, pinned known_hosts ve remote marker gerektirir.
