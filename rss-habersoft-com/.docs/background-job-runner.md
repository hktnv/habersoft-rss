# Background Job Runner

## Kapsam

MS-014, `main-service-worker` icinde BullMQ tabanli internal job runner'i uygular. Bu yuzey public HTTP API degildir; tenant veya Agent client'lari Redis/BullMQ state'ine baglanmaz.

Worker, `main-service-api` process'inden ayridir. API process'i cleanup consumer'i, canonical scheduler veya process-local cron calistirmaz.

## Queue Registry

Typed registry `src/maintenance/maintenance.registry.ts` icindedir:

- Queue: `main-service.maintenance`
- Job: `cleanup.run.v1`
- Job scheduler: `cleanup.daily`
- Cron: `0 3 * * *`
- Timezone: `UTC`
- Global concurrency: `1`
- Worker local concurrency: `1`

Ortam izolasyonu queue adini degistirerek degil, `BULLMQ_PREFIX` ile yapilir. Local Compose varsayilani:

```text
BULLMQ_PREFIX=main-service-local
```

## Scheduler Reconciliation

Worker bootstrap sirasinda Redis'e baglanir, BullMQ global concurrency degerini `1` olarak uzlastirir ve `cleanup.daily` scheduler kaydini idempotent `upsert` ile olusturur. Redis state'i silindiginde worker yeniden baslatma sirasinda expected registry'den scheduler'i tekrar kurar.

Repeatable-job legacy API veya OS cron kullanilmaz. `cleanup.run.v1` job payload'i typed ve minimaldir; business veri, secret veya DB satiri tasimaz.

## Retry ve Terminal Failure

Cleanup job'u pre-step altyapi/configuration hatalari icin `3` attempt ve exponential backoff ile yeniden denenir. Bir cleanup step'i basladiktan sonra step failure typed sonuc olarak kaydedilir, kalan stepler calistirilir ve run summary sonrasinda job BullMQ failed set'e terminal olarak yazilir.

Unsupported job name veya invalid payload unrecoverable kabul edilir. Bu durum retry ile iyilesmez.

Completed/failed BullMQ job retention degerleri worker configuration'dan gelir:

```text
MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS=604800
MAINTENANCE_COMPLETED_JOB_MAX_COUNT=1000
MAINTENANCE_FAILED_JOB_RETENTION_SECONDS=2592000
MAINTENANCE_FAILED_JOB_MAX_COUNT=5000
```

## Readiness ve Shutdown

`npm run worker:health`, worker container'i icinden PostgreSQL, Redis, global concurrency ve scheduler inventory uyumunu kontrol eder. Health komutu scheduler yaratmaz, job enqueue etmez ve consumer baslatmaz.

Worker shutdown sirasinda BullMQ worker, queue events ve queue baglantilari kapatilir. Beklenmeyen crash veya lock kaybi durumunda BullMQ at-least-once redelivery yapabilir; cleanup SQL'leri bu nedenle re-entrant ve bounded batch seklinde tasarlanmistir.

## Testler

Ilgili komutlar:

```powershell
docker compose run --rm main-service-worker npm run worker:health
docker compose run --rm main-service-worker npm run test:job-runner
docker compose run --rm main-service-worker npm run test:queue
```

`test:job-runner`, orchestrator failure policy ve API/worker module boundary kontrollerini calistirir. `test:queue`, Redis/BullMQ uzerinde scheduler reconciliation, global concurrency ve typed job processing davranisini dogrular.

## MS-016 Production Placement

Production Compose worker'i API'den ayri long-running role olarak ayni immutable image'dan calistirir. Worker public port yayinlamaz; PostgreSQL ve Redis/BullMQ internal network bagimliliklarini kullanir. Production topology icin bkz. [production-deployment.md](production-deployment.md).
