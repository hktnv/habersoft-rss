# Production Deployment

## Sorumluluk

Bu belge `main-service` icin single-host production Compose topology'sini, edge/vhost sinirini, service/network/port/volume/startup/readiness/config placement'ini ve MS-018C sonrasi active production source/build modelini aciklar.

Current production activation evidence'in canonical sahibi [production-acceptance.md](production-acceptance.md) dosyasidir. Bu belge evidence bloklarini tekrar etmez; runtime topology ve operator delivery modelini aciklar.

## Master ve DEV Referanslari

- Master Deployment View: `../../.md/master/23-uretim-deployment-gorunumu.md`
- Main-service DEV leaf: `../../.md/sub-docs/main-service/13-uretim-deployment-ve-release-paketleme-tasarimi.md`
- Application version: `0.1.0-ms-017`
- Application status: `MVP — Production Aktif`
- Master baseline: `rss-habersoft-master-v12`
- Master SHA-256: `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`

## Topology

Production model tek Linux host + Docker Engine / Docker Compose v2 modelidir. Dedicated `rss.habersoft.com` vhost TLS termination ve reverse proxy rolundedir. Host CyberPanel/OpenLiteSpeed ile yonetiliyorsa CyberPanel yalniz edge DNS/TLS/reverse-proxy siniridir; `main-service` runtime CyberPanel Node/app process modeliyle calismaz.

Production source acquisition Git-only operator akisidir: lokal source tree sunucuya upload edilmez; operator sunucuda `git pull --ff-only origin main` ile exact commit'i alir, Docker image'i sunucuda build eder ve generated `deploy/runtime-image.env` ile Compose'u calistirir. Production Compose invocation explicit `deploy/production/compose.yaml`, external shared production env ve `deploy/runtime-image.env` context'i ile yapilir; bare `docker compose ...` production command'i degildir. Codex production SSH kullanmaz; server Git/Docker/OpenLiteSpeed/TLS islemleri operator-managed kalir.

Production Compose service inventory:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

`tenant-auth-jwks-fixture`, source bind mount, debug/admin/dashboard service, public PostgreSQL portu, public Redis portu ve public worker portu production Compose icinde yoktur.

## Config ve Image Identity

Shared env dosyasi config ve secret inventory'sini tasir; `MAIN_SERVICE_IMAGE` shared env icinde bulunmaz.

Production image identity modeli:

1. operator canonical `origin/main` uzerinden source'u server-side Git pull ile alir,
2. server-local Docker build exact checkout'tan immutable image uretir,
3. generated `deploy/runtime-image.env` build edilen image ID'sini tasir,
4. Compose shared env ve runtime image env dosyalarini birlikte kullanir.

Package-derived staging image modeli production identity olarak kullanilmaz. MS-019B collector-v2 receipt exact production Git commit, runtime image ID ve image revision/source label chain'ini kaydetti; current status owner [production-acceptance.md](production-acceptance.md) dosyasidir.

## Network ve Portlar

API yalniz host loopback uzerinden edge'e acilir: `127.0.0.1:${API_HOST_PORT}:3000`. Worker, PostgreSQL ve Redis host port yayinlamaz. PostgreSQL ve Redis yalniz internal Docker network'te kullanilir.

Same-host default port matrix, mevcut auth binding'leriyle carpismaz: auth API `127.0.0.1:3100`, auth panel `127.0.0.1:8080`, RSS API default `127.0.0.1:3200`, future RSS panel reservation `127.0.0.1:8081`. MS-018C operator evidence RSS backend API upstream default'unun `127.0.0.1:3200` oldugunu kaydeder.

Edge, `/health/live` ve `/health/ready` upstream checks icin kullanabilir. Request body limit'i `POST /agent/entries` 5 MiB sozlesmesini kesmeyecek sekilde edge tarafinda ayarlanmalidir. Edge body-limit verification MS-018C inputunda `NOT_RECORDED` kalir.

## Startup ve Readiness

1. PostgreSQL ve Redis baslar.
2. `migrate` ayni immutable image ile `npm run migrate:deploy` calistirir.
3. Migration basarili olursa API ve worker baslar.
4. API `/health/live` ve `/health/ready` ile izlenir.
5. Worker `npm run worker:health` ile izlenir.

MS-019B collector-v2 receipt API live/ready, dependency readiness, migration status, worker health ve scheduler evidence'i partial operational receipt kapsaminda kaydetti. MS-019C production backup/restore receipt backup restore baseline'i `PASSED` olarak kaydetti. Previous pointer, long-term stability, error-burst ve edge body-limit evidence'i hala kayitli degildir.

## Durum

`main-service` backend application status'u `MVP — Production Aktif`tir.

Operator 2026-06-22 tarihinde internal loopback ve public HTTPS `/health/live` ile `/health/ready` checks icin HTTP `200`, `status=live/ready`, `postgres=up`, `redis=up` ve `tenantAuth=up` evidence sagladi. MS-019B collector-v2 receipt ile extended operational evidence `PARTIAL_ACCEPTED` oldu; MS-019C ile production backup/restore `PRODUCTION_BACKUP_RESTORE_VERIFIED` durumuna gecti. Full operational baseline previous pointer evidence eksikligi nedeniyle passed degildir.

Registry publish, Git tag ve GitHub Release yapilmamistir. Frontend implementasyonu yoktur ve `rss-panel.habersoft.com` active degildir. Bagimsiz Agent application ve bagimsiz Tenant applications ayri delivery siniridir.

MS-017C staging drill tarihsel kanit olarak korunur: approved staging target uzerinde full deployment, synthetic sentinel, PostgreSQL backup, off-host restore verification, rollback to `0.1.0-ms-016`, roll-forward to `0.1.0-ms-017`, final current pointer candidate promotion ve final running services acceptance passed. Staging source/package/image kimlikleri production identity degildir.

## Guvenli Troubleshooting

Generated production env file, backup, SBOM, provenance, image tarball, receipt ve registry auth Git'e commit edilmez. Gercek host/IP/cert/secret bu belgeye yazilmaz.
