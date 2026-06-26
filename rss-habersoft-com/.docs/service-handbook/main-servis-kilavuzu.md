# Main Service Kilavuzu

## Hizmetin amaci

`main-service`, rss.habersoft.com ekosisteminde feed aboneliklerini, entry kayitlarini, tenant gorunurlugunu, Agent'tan gelen is sonuclarini ve bakim islerini merkezi olarak yonetir.

Server tarafinda asil kaynak PostgreSQL'dir. Redis rate-limit ve BullMQ runtime state'i icin kullanilir. Agent veya Tenant client canonical veritabanina dogrudan baglanmaz.

## API / worker / migrate ayrimi

API rolunun isi HTTP isteklerini almak, auth dogrulamak, Tenant ve Agent endpoint'lerini calistirmak ve health yaniti vermektir.

Worker rolunun isi BullMQ cleanup scheduler'ini ve cleanup job runner'ini calistirmaktir. Public HTTP portu yoktur.

Migrate rolu finite calisir. Production ve staging'de ayni immutable application image ile Prisma migration uygular ve sonra biter.

## Five production services

Production Compose modeli bes servisten olusur:

- `postgres`
- `redis`
- `migrate`
- `main-service-api`
- `main-service-worker`

Local JWKS fixture, debug service, dashboard, public DB portu veya public Redis portu production Compose sinirinda yoktur.

## Loopback ve internal port modeli

Public trafik edge uzerinden `80/443` portlarina gelir. Edge, API upstream'ine host loopback uzerinden gider.

API container icinde `3000` portunu dinler. PostgreSQL Docker network icinde `5432`, Redis Docker network icinde `6379` kullanir. Worker host portu yayinlamaz.

Gercek production loopback portu bu el kitabinda hardcode edilmez; operator-owned env ve target descriptor tarafindan secilir.

Current operator default'u `rss.habersoft.com` backend API icin `127.0.0.1:3200` upstream'idir. Operator port uygunlugunu production sunucusunda dogrular; conflict varsa env ve edge upstream birlikte degistirilir.

Current production activation status `MVP — Production Aktif` olarak [../production-acceptance.md](../production-acceptance.md) dosyasinda tutulur. Bu kilavuz evidence receipt detaylarini tekrar etmez.

## Startup order

1. PostgreSQL ve Redis baslar.
2. `migrate` migration durumunu uygular.
3. API ve worker baslar.
4. API readiness PostgreSQL, Redis ve tenantAuth hazirligini kontrol eder.
5. Worker health scheduler ve queue durumunu kontrol eder.

## Readiness ve liveness

`/health/live`, API process'inin HTTP cevap verebildigini gosterir.

`/health/ready`, PostgreSQL, Redis ve tenant JWKS cache hazirligini birlikte kontrol eder. Tenant auth hazir degilse API live kalabilir ama ready sayilmaz.

Worker icin `npm run worker:health`, PostgreSQL, Redis, global concurrency ve `cleanup.daily` scheduler uyumunu kontrol eder.

## Database entities ve basit iliskiler

`feeds`: paylasilan RSS kaynagi.

`site_feeds`: tenant abonelik iliskisi.

`entries`: feed item kayitlari.

`entry_details`: optional enriched detail.

`agent_feed_check_events`: idempotency/event ledger.

`agent_runtime_status`: latest Agent heartbeat/current state.

Tenant gorunurlugu `site_feeds` uzerinden verilir. Agent sonuclari `feeds`, `entries`, `entry_details` ve event ledger uzerinden canonical state'e yazilir.

## Tenant request path

Tenant request'i `Authorization: Bearer <JWT>` ile gelir. API once JWT/JWKS dogrular, sonra tenant rate-limit uygular ve controller'a immutable tenant principal verir.

Tenant kimligi body, query veya path icinden override edilmez.

## Agent request path

Agent request'i `X-Agent-Key` ile gelir. Bu key yalniz Agent route'larini acar; Tenant route'larini acmaz.

Agent due feed listesini okur, dis dunyada fetch/normalize eder ve sonucu entry ingestion veya feed-check-results endpoint'leriyle bildirir. Agent DB connection tasimaz.

## Scheduler ve cleanup sorumlulugu

Cleanup scheduler worker tarafindadir. Queue adi `main-service.maintenance`, scheduler `cleanup.daily`, job `cleanup.run.v1`, timezone `UTC`, global concurrency `1` ve local concurrency `1` olarak tutulur.

Cleanup public API veya Agent'in tetikledigi bir is degildir.

## Backup ve rollback prensibi

Production mutasyonundan once veya ilk deployment'ta public cutover oncesi PostgreSQL backup alinip off-host restore dogrulanir. Redis canonical business data kaynagi degildir.

Rollback once immutable image/pointer/edge durumunu geri almayi hedefler. DB restore sadece kanitlanmis data/schema uyumsuzlugu varsa dusunulur.

## Main-service ne yapmaz?

`main-service`, RSS'i kendisi fetch etmez, Agent runtime implementasyonu degildir, token mint etmez, auth-service introspection yapmaz, frontend veya admin paneli sunmaz, production DNS/TLS credential'i saklamaz.

## Ayrintili operasyon belgeleri

- [../production-deployment.md](../production-deployment.md)
- [../../PRODUCTION.md](../../PRODUCTION.md)
- [../release-packaging.md](../release-packaging.md)
- [../backup-and-restore.md](../backup-and-restore.md)
- [../production-rollout-runbook.md](../production-rollout-runbook.md)
- [../staging-deployment-and-rollback.md](../staging-deployment-and-rollback.md)
