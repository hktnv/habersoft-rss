# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-004 tenant feed abonelik API dilimini iceren repository'dir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu milestone container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli, API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisi ve tenant feed abonelik endpoint'lerini icerir.

Tenant entry endpoint'leri, Agent API endpoint'i, BullMQ consumer, cleanup scheduler, rate limiting, admin arayuzu ve feed URL network/RSS dogrulama davranislari bu repository artiminda uygulanmamistir.
