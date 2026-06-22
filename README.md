# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-017 staging deployment adayidir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu surum container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi, tenant feed abonelik endpoint'leri, tenant basina Redis rate limiting davranisi, `GET /api/entries` hafif liste endpoint'i, `GET /api/entries/{id}/detail` detail endpoint'i, Agent `X-Agent-Key` authentication altyapisi, `POST /agent/heartbeat` current-state endpoint'i, read-only `GET /agent/feeds/due` endpoint'i, read-only `POST /agent/feeds/{feed_id}/new-guids` endpoint'ini, idempotent `POST /agent/entries` ingestion endpoint'ini, idempotent batch `POST /agent/feed-check-results` outcome ingestion endpoint'ini, worker-only BullMQ cleanup job runner'ini ve production Compose/release package dogrulama araclarini icerir.

Application version: `0.1.0-ms-017`.
Application status: `Staging Adayi`.
Master baseline: `rss-habersoft-master-v12`.

Staging Adayi status'u production deploy yapildigi anlamina gelmez. MS-017C candidate package ve approved staging drill kapisini hedefler; production rollout, registry publish, Git tag, GitHub Release, DNS/TLS/CyberPanel live change yapmaz. MS-017C1A-3R ile `STAGING_USES_PRODUCTION_IDP` decision altinda canonical production JWKS readiness-only proof passed oldu; full staging deployment, backup/restore, rollback/roll-forward ve current symlink promotion henuz kabul edilmedi. Public route inventory, schema ve migrations degismemistir.
