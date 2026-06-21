# Production Deployment

## Sorumluluk

Bu belge MS-016 ile uygulanmis production deployment package'inin single-host Compose topology'sini, edge/vhost sinirini, service/network/port/volume/startup/readiness/config placement'ini ve deploy edilmemislik durumunu aciklar.

## Master ve DEV Referanslari

- Master Deployment View: `../../.md/master/23-uretim-deployment-gorunumu.md`
- Main-service DEV leaf: `../../.md/sub-docs/main-service/13-uretim-deployment-ve-release-paketleme-tasarimi.md`
- Application version: `0.1.0-ms-016`
- Master baseline: `rss-habersoft-master-v12`
- Master SHA-256: `def24246ee3fe2f3feabee35e3c658216899d343d21b32637622271bc74d8e50`

## Topology

Production package tek Linux host + Docker Engine / Docker Compose v2 modelini uygular. Dedicated `rss.habersoft.com` vhost TLS termination ve reverse proxy rolundedir. Host CyberPanel/OpenLiteSpeed ile yonetiliyorsa CyberPanel yalniz edge DNS/TLS/reverse-proxy siniridir; `main-service` runtime CyberPanel Node/app process modeliyle calismaz.

Production Compose service inventory:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

`tenant-auth-jwks-fixture`, source bind mount, debug/admin/dashboard service, public PostgreSQL portu, public Redis portu ve public worker portu production Compose icinde yoktur.

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

## Guvenli Troubleshooting

Generated production env file, backup, SBOM, provenance, image tarball ve registry auth Git'e commit edilmez. Gercek host/IP/cert/secret bu belgeye yazilmaz.
