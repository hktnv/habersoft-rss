# Cleanup Retention

## Kapsam

MS-014 cleanup retention orkestrasyonu yalniz `main-service-worker` icinde calisir. Yeni HTTP route, yeni tablo, yeni migration veya public admin API eklemez.

Canonical retention degerleri worker configuration'ina zorunlu olarak girer:

```text
ENTRY_RETENTION_DAYS=30
ENTRY_MAX_PER_FEED=10000
ENTRY_DETAIL_RETENTION_DAYS=7
ENTRY_DETAIL_MAX_PER_FEED=2000
```

Agent feed-check event retention MS-014 registry'sinde `48` saat olarak sabittir.

## Orkestrasyon Sirasi

Tek BullMQ job'u `cleanup.run.v1`, master cleanup run'inin tamamini temsil eder. Step'ler tek tek job'a bolunmez.

1. `entries_age`
2. `entries_cap`
3. `entry_details_age`
4. `entry_details_cap`
5. `agent_feed_check_events_age`
6. `vacuum_analyze`
7. `run_summary`

Bir step failure verdiginde orchestrator sonraki stepleri calistirmaya devam eder, `cleanup_step_failed{step=...}` sinyalini loglar ve run summary sonrasinda terminal failed sonuc uretir.

## Retention SQL Davranisi

Entry age cleanup, `entries.created_at` alanina gore `ENTRY_RETENTION_DAYS` disinda kalan en eski satirlari bounded batch olarak siler. Entry delete, canonical FK cascade ile `entry_details` satirlarini da temizler.

Entry cap cleanup, feed basina `ENTRY_MAX_PER_FEED` degerini asan feed'lerde en yeni effective entry'leri tutar; eski excess entry'leri bounded batch olarak siler.

Detail age cleanup, `entry_details.created_at` alanina gore eski detail satirlarini siler ve ayni transaction icinde parent `entries.has_detail=false` yazar.

Detail cap cleanup, feed basina `ENTRY_DETAIL_MAX_PER_FEED` degerini asan detail satirlarinda en yeni effective detail'leri tutar; eski excess detail'leri siler ve parent entry flag'lerini ayni transaction icinde false yapar.

Agent feed-check event cleanup, `agent_feed_check_events.created_at` alanina gore 48 saatten eski event'leri bounded batch olarak siler.

`VACUUM ANALYZE`, `entries`, `entry_details` ve `agent_feed_check_events` tablolarinda calisir. Vacuum komutlari transaction icinde calistirilmaz.

## Telemetry

Structured log alanlari queue/job/run kimligini, step adini, terminal status'u, silinen satir sayisini ve sure bilgisini tasir. Raw DB row, RSS content, credential veya buyuk payload loglanmaz.

## Testler

Ilgili komutlar:

```powershell
docker compose run --rm main-service-worker npm run test:cleanup
docker compose run --rm main-service-worker npm run test:db:cleanup
```

`test:cleanup`, canonical registry ve typed payload policy'sini dogrular. `test:db:cleanup`, Compose PostgreSQL uzerinde age/cap deletion, parent `has_detail` guncellemesi, event retention ve vacuum davranisini test eder.
