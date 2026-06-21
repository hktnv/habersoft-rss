# main-service PROD Dokumantasyon Girisi

## Uygulama ve Repository Siniri

- Uygulama kimligi: `main-service`
- Repository yolu: `C:\Users\EVO-MRDM\Desktop\habersoft-auth\rss-habersoft-com\main-service`
- Canonical repository remote: `https://github.com/hktnv/habersoft-rss`
- PROD dokuman seti sorumlulugu: Bu repository'de gercekten uygulanmis main-service surumunun kurulum, calistirma, dogrulama ve operasyon gercegini aciklamak.
- Belge sahibi: `Main Service Teknik Sahibi`
- Uygulama surumu/durum: `0.1.0-ms-016` / `MVP Adayi - Deployment Karari Kesin / Release Paketi Dogrulandi`

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
| [agent-new-guid-filtering.md](agent-new-guid-filtering.md) | MS-011 `POST /agent/feeds/{feed_id}/new-guids` endpoint'i, strict request validation, duplicate/order policy, advisory DB filter ve no-side-effect sinirlari. |
| [agent-entry-ingestion.md](agent-entry-ingestion.md) | MS-012 `POST /agent/entries` endpoint'i, strict validation, idempotent replay, atomic entry/detail/event/feed-state write ve checked_at window sinirlari. |
| [agent-feed-check-results.md](agent-feed-check-results.md) | MS-013 `POST /agent/feed-check-results` endpoint'i, strict validation, idempotent batch replay, out-of-order accounting ve monotonic feed-state write sinirlari. |
| [background-job-runner.md](background-job-runner.md) | MS-014 worker-only BullMQ queue, scheduler reconciliation, retry, readiness ve shutdown gercegi. |
| [cleanup-retention.md](cleanup-retention.md) | MS-014 cleanup retention orkestrasyonu, canonical step sirasi, bounded SQL davranisi ve telemetry siniri. |
| [mvp-release-readiness.md](mvp-release-readiness.md) | MS-015 MVP adayinin release-blocker tanimi, kabul komutlari, gate matrisi, clean-room yontemi ve residual risk siniri. |
| [production-deployment.md](production-deployment.md) | MS-016 single-host production Compose topology, edge/vhost, service/network/port/volume/startup/readiness ve deploy edilmemislik durumu. |
| [release-packaging.md](release-packaging.md) | MS-016 release package command, artifact inventory, manifest/checksum/SBOM/provenance, image identity, verifier ve publication/deployment ayrimi. |
| [backup-and-restore.md](backup-and-restore.md) | MS-016 PostgreSQL backup prerequisite, checksum metadata, disposable restore verification, Redis siniri ve rollback data-protection gate'i. |
| [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md) | MS-017 staging deployment/rollback tatbikati icin target safety, SSH, receipt ve blocked-before-remote-staging operasyon gercegi. |

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
11. [agent-new-guid-filtering.md](agent-new-guid-filtering.md)
12. [agent-entry-ingestion.md](agent-entry-ingestion.md)
13. [agent-feed-check-results.md](agent-feed-check-results.md)
14. [background-job-runner.md](background-job-runner.md)
15. [cleanup-retention.md](cleanup-retention.md)
16. [mvp-release-readiness.md](mvp-release-readiness.md)
17. [production-deployment.md](production-deployment.md)
18. [release-packaging.md](release-packaging.md)
19. [backup-and-restore.md](backup-and-restore.md)
20. [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md)
21. [database-schema.md](database-schema.md)
22. Repository kok [README.md](../README.md)

## Master/DEV Uyum Kaydi

Bu `.docs/` kumesi, merkezi [Polyrepo DEV ve PROD Dokumantasyon Sozlesmesi](../../.md/master/00-POLYREPO-DEV-VE-PROD-DOKUMANTASYON-SOZLESMESI.md) ile uyumlu olacak sekilde yalnizca uygulanmis repository gercegini aciklar. Sistem capindaki master sozlesmeleri degistirmez.

- Uygulama kimligi: `main-service`
- Repository: `https://github.com/hktnv/habersoft-rss`
- Uygulama surumu: `0.1.0-ms-016`
- Master kaynak: `../../.md/master/`
- Master baseline: `rss-habersoft-master-v12`
- Master agac ozeti SHA-256: `df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430`
- Ilgili DEV alt kumesi: `../../.md/sub-docs/main-service/`
- Uyum durumu: `Deployment Karari Kesin / Release Paketi Dogrulandi`

`MVP Adayi`, main-service repository acceptance sonucudur. Production deployment karari MS-016 ile kesinlesmistir; production rollout, artifact publication, Git tag, GitHub Release, Agent application readiness veya Tenant application readiness iddiasi degildir.

v11 etki notu: MS-014 uygulamasi v11 master cleanup, retention ve job-runner sozlesmeleriyle uyumludur. `POST /agent/feed-check-results` response'u MS-013'te v11 dort-sayac sozlesmesini `accepted`, `feed_state_updated`, `idempotent_replay_count` ve `out_of_order_result_count` olarak uygulamaya devam eder.

v12 etki notu: MS-016 production deployment karari master `23-uretim-deployment-gorunumu.md` ile kapanmistir. Release package identity canonical master hash ile hizalanmistir; staging-handoff paketi image artifact dahil edildiginde dogrulanir. Production deploy, registry publish, DNS/TLS/CyberPanel live change, Git tag ve GitHub Release yapilmamistir.

MS-017 hazirlik notu: Staging target descriptor, pinned SSH known_hosts ve remote staging marker active workspace'te bulunmadigi icin remote staging deployment yapilmamistir. Hazirlik tooling'i [staging-deployment-and-rollback.md](staging-deployment-and-rollback.md) dosyasinda belgelenir; uygulama surumu ve status `0.1.0-ms-016` / `MVP Adayi - Deployment Karari Kesin / Release Paketi Dogrulandi` olarak kalir.

MS-017B1 notu: Staging operator input tooling prepared. Operator external target/env/known_hosts girdilerini local-only scaffold ve verify komutlariyla hazirlayabilir. Remote staging preflight not executed; staging deployment still not executed.

## Sabit Runtime ve Altyapi Surumleri

- Node.js application image: `node:24.17.0-bookworm-slim`
- Node.js exact patch: `24.17.0`
- NestJS: `11.1.27`
- Prisma CLI ve Client: `6.19.3`
- Redis client: `ioredis 5.11.1`
- BullMQ: `5.79.0`
- NestJS BullMQ integration: `@nestjs/bullmq 11.0.4`
- JOSE/JWT library: `jose 6.2.3`
- PostgreSQL image: `postgres:17.9-bookworm`
- Redis image: `redis:8.8.0-trixie`

## Yerel Dokumantasyon Kontrolu

Davranisi, calistirma komutunu, configuration anahtarini veya container topolojisini etkileyen her degisiklik ayni degisiklik dizisinde `.docs/` alanina yansitilir. Gercek secret, credential veya uretim ortam degeri dokumana yazilmaz.
