# main-service PROD Dokumantasyon Girisi

## Uygulama ve Repository Siniri

- Uygulama kimligi: `main-service`
- Repository yolu: `C:\Users\EVO-MRDM\Desktop\habersoft-auth\rss-habersoft-com\main-service`
- Canonical repository remote: `canonical remote pending`
- PROD dokuman seti sorumlulugu: Bu repository'de gercekten uygulanmis main-service surumunun kurulum, calistirma, dogrulama ve operasyon gercegini aciklamak.
- Belge sahibi: `Main Service Teknik Sahibi`
- Uygulama surumu/durum: `0.1.0-ms-003` / `Geciste`

Bu repository, merkezi `.md/` DEV dokuman agacindan ayri bir application repository siniridir. Merkezi master ve DEV alt dokumanlar bu repository'ye kopyalanmaz.

## Aktif PROD Belge Envanteri

| Belge | Sorumluluk |
|---|---|
| [README.md](README.md) | Repository-local PROD dokumantasyon girisi, envanter ve uyum kaydi. |
| [local-development.md](local-development.md) | Gercek yerel container gelistirme, calistirma, local JWKS fixture ve dogrulama komutlari. |
| [database-schema.md](database-schema.md) | MS-002 canonical PostgreSQL business schema, migration ve DB test gercegi. |
| [tenant-authentication.md](tenant-authentication.md) | MS-003 tenant RS256 JWT/JWKS dogrulama altyapisi, readiness ve sinirlar. |

## Okuma Sirasi

1. [README.md](README.md)
2. [local-development.md](local-development.md)
3. [tenant-authentication.md](tenant-authentication.md)
4. [database-schema.md](database-schema.md)
5. Repository kok [README.md](../README.md)

## Master/DEV Uyum Kaydi

Bu `.docs/` kumesi, merkezi [Polyrepo DEV ve PROD Dokumantasyon Sozlesmesi](../../.md/master/00-POLYREPO-DEV-VE-PROD-DOKUMANTASYON-SOZLESMESI.md) ile uyumlu olacak sekilde yalnizca uygulanmis repository gercegini aciklar. Sistem capindaki master sozlesmeleri degistirmez.

- Uygulama kimligi: `main-service`
- Repository: `canonical remote pending`
- Uygulama surumu: `0.1.0-ms-003`
- Master kaynak: `../../.md/master/`
- Master baseline: `rss-habersoft-master-v10`
- Master agac ozeti SHA-256: `1673e90d7c7596e13053c7669044a08a09b4a9b70fd9c54c8c5c0e59f8aed192`
- Ilgili DEV alt kumesi: `../../.md/sub-docs/main-service/`
- Uyum durumu: `Geciste`

`Geciste` durumu bilincli kullanilmistir. MS-003 API process'i icin tenant JWT/JWKS dogrulama altyapisini ve readiness entegrasyonunu olusturur; gercek Tenant API endpoint'i, Agent API, cleanup scheduler ve job runner davranislari henuz uygulanmamistir.

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
