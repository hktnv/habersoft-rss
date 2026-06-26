# Tenant Entry Detail

## Kapsam

MS-007, mevcut Tenant API guvenlik zinciri uzerinden su read-only endpoint'i ekler:

```text
GET /api/entries/{id}/detail
```

Kanonik kaynaklar: `../../.md/master/20-tenant-api-sozlesmesi.md`, `../../.md/master/12-veri-modeli.md`, `../../.md/master/10-icerik-saklama.md` ve `../../.md/sub-docs/main-service/06-tenant-entry-detayi-tasarimi.md`.

## Auth ve Rate Limit

Guard sirasi:

1. `TenantJwtAuthGuard`
2. tenant rate-limit guard
3. controller validation ve use-case

Tenant kimligi yalnizca verified `TenantPrincipal.siteClientId` alanindan gelir. Auth hatalari kota tuketmez. Auth basarili olduktan sonra invalid id/query, 404 ve 200 sonuclari feed ve entry-list endpoint'leriyle ayni tenant-wide Redis bucket'ini tuketir.

## Request Validation

Path `id` strict positive PostgreSQL bigint decimal string olmalidir. `0`, negatif, leading zero, ondalikli veya bigint ustu degerler `422` ve `{ "error_code": "VALIDATION_FAILED" }` ile reddedilir.

Query parametresi kabul edilmez. Unknown query veya tenant override girisimi de ayni validation sonucuna gider.

## Response

Gorunur entry ve aktif detail satiri varsa:

```json
{
  "entry_id": "123",
  "has_detail": true,
  "detail": "<p>Makale tam metni</p>",
  "images": ["https://cdn.example.test/image.jpg"],
  "videos": [],
  "tags": ["gundem"],
  "author": "Haber Merkezi",
  "meta": { "og:site_name": "Example" },
  "detail_extraction": {
    "status": "ok",
    "attempted_at": "2026-06-20T10:00:01.000Z",
    "finalized_at": "2026-06-20T10:00:02.000Z",
    "error_code": null
  }
}
```

Gorunur entry var fakat aktif `entry_details` satiri yoksa response `200` olur ve `detail: null`, `has_detail: false` doner. Bu, detail hic uretilmedigi veya retention/cap cleanup sonrasi silindigi anlamina gelebilir. `detail_extraction.status = "ok"` ve `detail: null` birlikte gecerlidir; status tarihsel extraction sonucudur.

Entry yok, tenant abone degil veya entry baska tenant tarafindan gorulebilir durumdaysa public sonuc tek generic `404` olur. Yeni public `ENTRY_NOT_FOUND` veya `DETAIL_EXPIRED` error code yoktur.

`detail_length` public response'a cikmaz. Agent error code yalnizca `detail_extraction.error_code` alaninda stored veri olarak doner.

## Tenant Visibility

Visibility tek veritabani statement'i icinde `site_feeds.site_client_id = verified principal` predicate'i ile uygulanir. Global entry existence pre-check yoktur ve uygulama belleginde tenant filtering yapilmaz.

`feeds.active = true` detail gorunurlugu icin filtre degildir. Tenant halen aboneyse inactive feed'in retained entry/detail verisi gorunur. Tenant abonelikten ciktiginda core entry ve detail DB'de kalsa bile endpoint 404 doner.

## Query ve Invariantlar

Read modeli tek parameterized SQL operasyonudur:

- `entries` entry id filtresi,
- `site_feeds` tenant visibility join'i,
- optional `entry_details` left join'i.

N+1 query, lock, transaction, mutation, cache, read replica, projection table, materialized view veya network fetch yoktur.

`entries.has_detail` aktif detail satiri varliginin denormalize flag'idir. `has_detail=true` ama detail row yoksa veya `has_detail=false` ama detail row varsa uygulama bunu corrupt state kabul eder ve public DTO'ya sessizce maskelemez; response safe `500` olur.

JSONB alanlari response sinirinda dogrulanir. `images`, `videos`, `tags` array olarak, `meta` object olarak projekte edilir; object/array/string mismatch'i internal invariant failure kabul edilir.

## Operasyon ve Test

Tenant entry detail testleri:

```powershell
npm run test:tenant-entry-detail
```

Host ortaminda PostgreSQL/Redis compose DNS'i erisilebilir degilse integration senaryolari skip edilir. Compose icinde ayni script PostgreSQL ve Redis integration testlerini calistirir.

Troubleshooting icin once auth/rate-limit zincirini, path id validation sonucunu, tenantin `site_feeds` aboneligini, core `entries` satirini, `has_detail`/`entry_details` tutarliligini ve `detail_extraction` state'ini kontrol et. `EXPLAIN`, kucuk fixture'da seq scan secebilir; query shape ve mevcut indexlerin korunmasi asil kontroldur.

## Bilincli Disarida Birakilanlar

- Agent API ve Agent auth
- Detail re-fetch veya repair
- Cleanup/retention job implementation
- Entry write/ingestion
- Search/filter
- Redis detail cache veya HTTP cache contract
- Admin/frontend
- Yeni migration, schema, constraint veya index
