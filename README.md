# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-003 tenant JWT/JWKS dogrulama altyapisini iceren repository'dir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu milestone container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi, canonical PostgreSQL business schema migration temeli ve API process'ine ozel tenant RS256 JWT/JWKS dogrulama altyapisini icerir.

Gercek Tenant API endpoint'i, Agent API endpoint'i, BullMQ consumer, cleanup scheduler, rate limiting ve business use-case davranislari bu repository artiminda uygulanmamistir.
