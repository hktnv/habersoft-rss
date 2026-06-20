# Canonical Database Schema

## Kapsam

MS-002, master `12-veri-modeli.md` ile uyumlu canonical PostgreSQL business schema migration temelini ekler.

Bu repository'deki `schema.prisma`, canonical DB semasinin Prisma Client erisim projeksiyonudur. DB-native `GENERATED ALWAYS`, partial index, CHECK constraint ve composite FK kurallari `prisma/migrations/20260620001000_canonical_business_schema/migration.sql` icinde uygulanir.

## Migration History

- `20260620000000_initial_empty`: MS-001'den korunan bos baslangic migration'i.
- `20260620001000_canonical_business_schema`: MS-002 canonical business schema migration'i.

MS-002 yeni bir migration history olusturmaz ve mevcut bos initial migration'i yeniden yazmaz.

## Business Tablolari

MS-002 yalnizca su alti canonical tabloyu olusturur:

- `feeds`
- `entries`
- `entry_details`
- `site_feeds`
- `agent_feed_check_events`
- `agent_runtime_status`

Tenant, site, client, audit, soft-delete, outbox veya bootstrap veri tablosu eklenmemistir.

## Prisma Notlari

Prisma Client, temel model erisimini saglar. Asagidaki PostgreSQL ozellikleri canonical olarak migration SQL tarafindan sahiplenilir:

- `entries.effective_at` generated column.
- `feeds_due` partial index.
- CHECK constraint'ler.
- `entry_details(entry_id, feed_id) -> entries(id, feed_id)` composite FK.
- `entry_details.entry_id` primary key'i nedeniyle entry basina tek detail satiri DB tarafindan garanti edilir. Prisma composite relation projeksiyonunda bu iliski ek duplicate unique constraint uretmeden liste olarak temsil edilir.

Bu ozelliklerde migration SQL ile `schema.prisma` arasinda yorum farki olursa canonical kaynak migration SQL ve master veri modelidir.

`feeds_due` index'i `next_check_at ASC, id ASC` key order'una ve `active = true AND subscriber_count > 0` predicate'ine sahiptir. MS-010 `GET /agent/feeds/due` read-only sorgusu bu index ile uyumlu olarak `next_check_at <= captured server now` filtresi, canonical order ve `limit + 1` bounded read kullanir.

## Dogrulama

Container toolchain ile:

```powershell
docker compose run --rm main-service-api npm run prisma:validate
docker compose run --rm main-service-api npm run prisma:generate
docker compose run --rm main-service-api npm run test:db
```

`test:db`, izole bir PostgreSQL database uzerinde clean replay yapar, ikinci migration deploy'un no-op oldugunu dogrular, `prisma migrate status` calistirir ve tablo/index/constraint katalog kontrollerini yapar.
