# Local Staging Rehearsal

## Sorumluluk

Bu belge canonical production package ve Compose kaynaklarinin izole local Docker ortaminda candidate deployment, PostgreSQL backup/restore, immutable-image rollback ve roll-forward dry-run davranisini aciklar.

## Durum

Status: `Prepared / Not executed`

Local isolated staging rehearsal tooling hazirlandi. Bu durum remote staging preflight veya remote staging deployment basarisi degildir.

Application version remains: `0.1.0-ms-016`

Master baseline: `rss-habersoft-master-v12` / `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430` / `29`

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

External `local-staging-rehearsal-receipt.json` secret-free olmalidir ve su gercekleri tasir:

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
