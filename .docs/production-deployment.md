# Production Deployment

## Sorumluluk

Bu belge MS-016 ile uygulanmis production deployment package'inin single-host Compose topology'sini, edge/vhost sinirini, service/network/port/volume/startup/readiness/config placement'ini ve deploy edilmemislik durumunu aciklar.

## Master ve DEV Referanslari

- Master Deployment View: `../../.md/master/23-uretim-deployment-gorunumu.md`
- Main-service DEV leaf: `../../.md/sub-docs/main-service/13-uretim-deployment-ve-release-paketleme-tasarimi.md`
- Application version: `0.1.0-ms-017`
- Master baseline: `rss-habersoft-master-v12`
- Master SHA-256: `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`

## Topology

Production package tek Linux host + Docker Engine / Docker Compose v2 modelini uygular. Dedicated `rss.habersoft.com` vhost TLS termination ve reverse proxy rolundedir. Host CyberPanel/OpenLiteSpeed ile yonetiliyorsa CyberPanel yalniz edge DNS/TLS/reverse-proxy siniridir; `main-service` runtime CyberPanel Node/app process modeliyle calismaz.

Production Compose service inventory:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

`tenant-auth-jwks-fixture`, source bind mount, debug/admin/dashboard service, public PostgreSQL portu, public Redis portu ve public worker portu production Compose icinde yoktur.

## Config ve Image Identity

Shared env dosyasi config ve secret inventory'sini tasir; `MAIN_SERVICE_IMAGE` shared env icinde bulunmaz. Release package image artifact'i load/inspect edildikten sonra `runtime-image.env` icine `MAIN_SERVICE_IMAGE=sha256:<loaded-image-id>` olarak yazilir. Compose her zaman shared env ve release-local runtime image env dosyasini birlikte alir.

## Network ve Portlar

API yalniz host loopback uzerinden edge'e acilir: `127.0.0.1:${API_HOST_PORT}:3000`. Worker, PostgreSQL ve Redis host port yayinlamaz. PostgreSQL ve Redis yalniz internal Docker network'te kullanilir.

Edge, `/health/live` ve `/health/ready` upstream checks icin kullanabilir. Request body limit'i `POST /agent/entries` 5 MiB sozlesmesini kesmeyecek sekilde edge tarafinda ayarlanmalidir.

## Startup ve Readiness

1. PostgreSQL ve Redis baslar.
2. `migrate` ayni immutable image ile `npm run migrate:deploy` calistirir.
3. Migration basarili olursa API ve worker baslar.
4. API `/health/live` ve `/health/ready` ile izlenir.
5. Worker `npm run worker:health` ile izlenir.

## Durum

Package verified. Production rollout yapilmadi. DNS/TLS/CyberPanel live configuration degistirilmedi. Staging handoff MS-017 kapsamindadir.

MS-017C1A-R2 asamasinda package-derived image binding remote config-only proof'tan gecmistir. API/worker/PostgreSQL/Redis baslatilmamis, migration/readiness retry/rollback/roll-forward veya current symlink promotion yapilmamistir. Production runtime ve edge siniri degismemistir.

MS-017C1A-3R asamasinda staging target uzerinde production IdP readiness-only proof gecti. Canonical production JWKS endpoint'i strict HTTPS ile local/remote/candidate network katmanlarinda dogrulandi; preserved staging volumes uzerinde PostgreSQL, Redis, migrate no-op, API ve worker gecici olarak baslatilip iki readiness turu passed sonucuyla safe-stop edildi. Bu production rollout, full staging deployment kabul, backup/restore, rollback/roll-forward, current symlink promotion, artifact publication, Git tag veya GitHub Release anlamina gelmez.

## Guvenli Troubleshooting

Generated production env file, backup, SBOM, provenance, image tarball ve registry auth Git'e commit edilmez. Gercek host/IP/cert/secret bu belgeye yazilmaz.
