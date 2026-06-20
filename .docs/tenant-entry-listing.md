# Tenant Entry Listing

## Kapsam

MS-006, mevcut Tenant API guvenlik zinciri uzerinden su read-only endpoint'i ekler:

```text
GET /api/entries?offset=0&limit=50
```

Kanonik kaynaklar: `../../.md/master/20-tenant-api-sozlesmesi.md`, `../../.md/master/12-veri-modeli.md` ve `../../.md/sub-docs/main-service/05-tenant-entry-listesi-tasarimi.md`.

## Auth ve Rate Limit

Guard sirasi:

1. `TenantJwtAuthGuard`
2. tenant rate-limit guard
3. controller validation ve use-case

Tenant kimligi yalnizca verified `TenantPrincipal.siteClientId` alanindan gelir. Auth hatalari kota tuketmez. Auth basarili olduktan sonra invalid query dahil tum istekler feed endpoint'leriyle ayni tenant-wide Redis bucket'ini tuketir.

## Query Parametreleri

- `offset`: default `0`, aralik `0..1000`.
- `limit`: default `50`, aralik `1..100`.

Yalnizca `offset` ve `limit` kabul edilir. Unknown query parametresi, array degeri, negatif sayi, ondalikli sayi ve tenant override girisimleri `422` ve `{ "error_code": "VALIDATION_FAILED" }` ile reddedilir.

## Response

Response bare JSON array'dir. Total count, page envelope veya cache metadata yoktur. Bos sonuc `[]` doner.

Her eleman:

```json
{
  "id": "123",
  "guid": "entry-guid",
  "title": "Baslik",
  "url": "https://example.test/entry",
  "published_at": "2026-06-20T12:00:00.000Z",
  "effective_at": "2026-06-20T12:00:00.000Z",
  "summary": "Ozet",
  "feed_url": "https://example.test/feed.xml",
  "has_detail": true,
  "primary_image": "https://example.test/image.jpg",
  "tags": ["gundem"],
  "author": "Haber Merkezi"
}
```

`id` decimal string'dir. `published_at`, kaynak degeri yoksa `null` kalir. `effective_at` DB generated canonical siralama alanidir ve non-null ISO string olarak doner. `primary_image`, `entries.images` dizisinin ilk elemani veya `null` olur. `has_detail`, `entries.has_detail` flag'inden gelir.

## Tenant Visibility

Endpoint yalnizca tenantin halen abone oldugu feed'lerin entry'lerini dondurur. Visibility SQL predicate'i `site_feeds.site_client_id = verified principal` uzerinden uygulanir. Request body, query, path veya header tenant gorunurlugunu genisletemez.

`feeds.active = true` entry listing filtresi degildir. Tenant halen aboneyse inactive yapilmis feed'in retained entry'leri gorunur. Tenant abonelikten ciktiginda o feed'in entry'leri bu endpoint'te gorunmez.

## Query ve Projection

Read modeli tek bounded parameterized SQL operasyonudur:

- tenant-scoped `site_feeds` feed secimi,
- her feed icin `per_feed_window = offset + limit` bounded candidate scan,
- global `effective_at DESC, id DESC` order,
- final `OFFSET/LIMIT`.

Liste sorgusu `feeds` tablosuna `feed_url` icin join yapar. `entry_details` join'i yoktur ve `detail` list response'una tasinmaz. N+1 query, total count query, Redis entry cache, read replica, materialized view veya projection table yoktur.

Offset pagination concurrent insert veya retention degisikligi sirasinda cross-page snapshot garantisi vermez. Deep page maliyeti `offset <= 1000` ve `limit <= 100` ile bounded tutulur.

## Operasyon ve Test

Tenant entry testleri:

```powershell
npm run test:tenant-entries
```

Host ortaminda PostgreSQL/Redis compose DNS'i erisilebilir degilse integration senaryolari skip edilir. Compose icinde ayni script PostgreSQL ve Redis integration testlerini calistirir.

Troubleshooting icin once query validation sonucunu, tenantin `site_feeds` aboneligini, `entries_feed_effective` index planini ve rate-limit 429/503 davranisini kontrol et. `EXPLAIN`, kucuk fixture'da seq scan secebilir; bounded query shape ve index varligi asil kontroldur.

## Bilincli Disarida Birakilanlar

- `GET /api/entries/{id}/detail`
- Date, feed, tag, author veya search filtreleri
- Cursor/keyset pagination
- Total count veya response envelope
- Agent API, scheduler/job runner, cleanup
- Admin/frontend
- Read cache, projection table, materialized view, read replica
- Yeni migration veya schema/index degisikligi
