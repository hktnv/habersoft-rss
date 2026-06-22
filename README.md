# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-017 staging deployment adayidir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Servisleri sade bir entegrasyon okuma sirasiyla yeniden kavramak icin bkz. [.docs/service-handbook/README.md](.docs/service-handbook/README.md).

Bu surum container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi, tenant feed abonelik endpoint'leri, tenant basina Redis rate limiting davranisi, `GET /api/entries` hafif liste endpoint'i, `GET /api/entries/{id}/detail` detail endpoint'i, Agent `X-Agent-Key` authentication altyapisi, `POST /agent/heartbeat` current-state endpoint'i, read-only `GET /agent/feeds/due` endpoint'i, read-only `POST /agent/feeds/{feed_id}/new-guids` endpoint'ini, idempotent `POST /agent/entries` ingestion endpoint'ini, idempotent batch `POST /agent/feed-check-results` outcome ingestion endpoint'ini, worker-only BullMQ cleanup job runner'ini ve production Compose/release package dogrulama araclarini icerir.

Application version: `0.1.0-ms-017`.
Application status: `MVP Adayi - Staging Dogrulandi / Rollback Tatbikati Gecti`.
Master baseline: `rss-habersoft-master-v12`.

MS-017C staging status'u production deploy yapildigi anlamina gelmez. `STAGING_USES_PRODUCTION_IDP` decision altinda approved staging target'ta candidate deployment, synthetic sentinel, PostgreSQL `pg_dump -Fc` backup, off-host restore verification, rollback to `0.1.0-ms-016`, roll-forward to `0.1.0-ms-017`, final current pointer promotion ve final running services acceptance passed. Production rollout, registry publish, Git tag, GitHub Release, DNS/TLS/CyberPanel live change yapilmadi. Public route inventory, schema ve migrations degismemistir.
