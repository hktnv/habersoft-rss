# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-014 cleanup job runner ve retention orkestrasyonu dikey dilimini iceren repository'dir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu milestone container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi, tenant feed abonelik endpoint'leri, tenant basina Redis rate limiting davranisi, `GET /api/entries` hafif liste endpoint'i, `GET /api/entries/{id}/detail` detail endpoint'i, Agent `X-Agent-Key` authentication altyapisi, `POST /agent/heartbeat` current-state endpoint'i, read-only `GET /agent/feeds/due` endpoint'i, read-only `POST /agent/feeds/{feed_id}/new-guids` endpoint'ini, idempotent `POST /agent/entries` ingestion endpoint'ini, idempotent batch `POST /agent/feed-check-results` outcome ingestion endpoint'ini ve worker-only BullMQ cleanup job runner'ini icerir.

Yeni public route, admin arayuzu, schema migration veya feed URL network/RSS dogrulama davranisi bu repository artiminda eklenmemistir.
