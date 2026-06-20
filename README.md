# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-006 Tenant entry listeleme API dilimini iceren repository'dir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu milestone container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi, tenant feed abonelik endpoint'leri, tenant basina Redis rate limiting davranisi ve `GET /api/entries` hafif liste endpoint'ini icerir.

Tenant entry detail endpoint'i, Agent API endpoint'i, BullMQ consumer, cleanup scheduler, admin arayuzu ve feed URL network/RSS dogrulama davranislari bu repository artiminda uygulanmamistir.
