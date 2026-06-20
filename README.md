# main-service

`main-service`, rss.habersoft.com ekosisteminin merkezi sunucu uygulamasi icin MS-002 canonical schema repository'sidir.

Uygulanan urun ve operasyon belgeleri icin bkz. [.docs/README.md](.docs/README.md).

Bu milestone container tabanli API/worker iskeleti, config dogrulama, PostgreSQL/Redis baglanti siniri, health yuzeyi ve canonical PostgreSQL business schema migration temelini icerir. Agent API, Tenant API, JWT dogrulama, BullMQ consumer, cleanup scheduler ve business use-case davranislari bu repository artiminda uygulanmamistir.
