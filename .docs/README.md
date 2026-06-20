# main-service PROD Dokumantasyon Girisi

## Uygulama ve Repository Siniri

- Uygulama kimligi: `main-service`
- Repository yolu: `C:\Users\EVO-MRDM\Desktop\habersoft-auth\rss-habersoft-com\main-service`
- Canonical repository remote: `https://github.com/hktnv/habersoft-rss`
- PROD dokuman seti sorumlulugu: Bu repository'de gercekten uygulanmis main-service surumunun kurulum, calistirma, dogrulama ve operasyon gercegini aciklamak.
- Belge sahibi: `Main Service Teknik Sahibi`
- Uygulama surumu/durum: `0.1.0-ms-010` / `Geciste`

Bu repository, merkezi `.md/` DEV dokuman agacindan ayri bir application repository siniridir. Merkezi master ve DEV alt dokumanlar bu repository'ye kopyalanmaz.

## Aktif PROD Belge Envanteri

| Belge | Sorumluluk |
|---|---|
| [README.md](README.md) | Repository-local PROD dokumantasyon girisi, envanter ve uyum kaydi. |
| [local-development.md](local-development.md) | Gercek yerel container gelistirme, calistirma, local JWKS fixture ve dogrulama komutlari. |
| [database-schema.md](database-schema.md) | MS-002 canonical PostgreSQL business schema, migration ve DB test gercegi. |
| [tenant-authentication.md](tenant-authentication.md) | MS-003 tenant RS256 JWT/JWKS dogrulama altyapisi, readiness ve sinirlar. |
| [tenant-feed-subscriptions.md](tenant-feed-subscriptions.md) | MS-004 tenant feed abonelik endpoint'leri, tenant izolasyonu, transaction ve sinirlar. |
| [tenant-rate-limiting.md](tenant-rate-limiting.md) | MS-005 Tenant API feed rotalarinda tenant basina Redis rate limiting davranisi ve sinirlari. |
| [tenant-entry-listing.md](tenant-entry-listing.md) | MS-006 Tenant entry listeleme API route, pagination, visibility, query/projection ve test gercegi. |
| [tenant-entry-detail.md](tenant-entry-detail.md) | MS-007 Tenant entry detail API route, visibility, retention/null/404 ayrimi, query/projection ve invariant test gercegi. |
| [agent-authentication.md](agent-authentication.md) | MS-008 Agent API `X-Agent-Key` authentication altyapisi, API-only secret siniri ve route-level guard davranisi. |
| [agent-heartbeat.md](agent-heartbeat.md) | MS-009 `POST /agent/heartbeat` endpoint'i, request validation, current-state upsert ve no-side-effect sinirlari. |
| [agent-due-feeds.md](agent-due-feeds.md) | MS-010 `GET /agent/feeds/due` endpoint'i, strict limit validation, due eligibility, order, limit+1/has_more ve read-only sinirlari. |

## Okuma Sirasi

1. [README.md](README.md)
2. [local-development.md](local-development.md)
3. [tenant-authentication.md](tenant-authentication.md)
4. [tenant-feed-subscriptions.md](tenant-feed-subscriptions.md)
5. [tenant-rate-limiting.md](tenant-rate-limiting.md)
6. [tenant-entry-listing.md](tenant-entry-listing.md)
7. [tenant-entry-detail.md](tenant-entry-detail.md)
8. [agent-authentication.md](agent-authentication.md)
9. [agent-heartbeat.md](agent-heartbeat.md)
10. [agent-due-feeds.md](agent-due-feeds.md)
11. [database-schema.md](database-schema.md)
12. Repository kok [README.md](../README.md)

## Master/DEV Uyum Kaydi

Bu `.docs/` kumesi, merkezi [Polyrepo DEV ve PROD Dokumantasyon Sozlesmesi](../../.md/master/00-POLYREPO-DEV-VE-PROD-DOKUMANTASYON-SOZLESMESI.md) ile uyumlu olacak sekilde yalnizca uygulanmis repository gercegini aciklar. Sistem capindaki master sozlesmeleri degistirmez.

- Uygulama kimligi: `main-service`
- Repository: `https://github.com/hktnv/habersoft-rss`
- Uygulama surumu: `0.1.0-ms-010`
- Master kaynak: `../../.md/master/`
- Master baseline: `rss-habersoft-master-v10`
- Master agac ozeti SHA-256: `1673e90d7c7596e13053c7669044a08a09b4a9b70fd9c54c8c5c0e59f8aed192`
- Ilgili DEV alt kumesi: `../../.md/sub-docs/main-service/`
- Uyum durumu: `Geciste`

`Geciste` durumu bilincli kullanilmistir. MS-010 production Agent route envanterini `POST /agent/heartbeat` ve `GET /agent/feeds/due` olarak genisletir; new-GUID filtreleme, entries ingestion, feed-check-results, cleanup scheduler ve job runner davranislari henuz uygulanmamistir.

## Sabit Runtime ve Altyapi Surumleri

- Node.js application image: `node:24.17.0-bookworm-slim`
- Node.js exact patch: `24.17.0`
- NestJS: `11.1.27`
- Prisma CLI ve Client: `6.19.3`
- Redis client: `ioredis 5.11.1`
- JOSE/JWT library: `jose 6.2.3`
- PostgreSQL image: `postgres:17.9-bookworm`
- Redis image: `redis:8.8.0-trixie`

## Yerel Dokumantasyon Kontrolu

Davranisi, calistirma komutunu, configuration anahtarini veya container topolojisini etkileyen her degisiklik ayni degisiklik dizisinde `.docs/` alanina yansitilir. Gercek secret, credential veya uretim ortam degeri dokumana yazilmaz.
