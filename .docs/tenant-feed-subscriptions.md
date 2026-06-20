# Tenant Feed Abonelikleri

## Kapsam

MS-004, Tenant API icin yalnizca feed abonelik dikey dilimini uygular:

- `POST /api/feeds`
- `GET /api/feeds`
- `DELETE /api/feeds/{feed_id}`

Butun endpoint'ler mevcut `TenantJwtAuthGuard` ile korunur. Tenant kimligi yalnizca dogrulanmis `TenantPrincipal.siteClientId` alanindan alinir.

## Public Contract

`POST /api/feeds` yalnizca su JSON body seklini kabul eder:

```json
{ "url": "https://example.test/rss.xml" }
```

URL mutasyonu, canonicalization, DNS, remote HTTP fetch, RSS parse veya MIME kontrolu yapilmaz. URL oldugu gibi feed identity olarak saklanir.

Basarili yeni abonelik `201` doner:

```json
{
  "feed_id": "1",
  "url": "https://example.test/rss.xml",
  "subscribed": true,
  "created_feed": true
}
```

Ayni tenant ayni feed'e zaten aboneyse istek idempotenttir ve `200` doner:

```json
{
  "feed_id": "1",
  "url": "https://example.test/rss.xml",
  "subscribed": true,
  "already_subscribed": true
}
```

Global olarak pasif feed'e abonelik `409` ve `{ "error_code": "FEED_ADMIN_DISABLED" }` ile reddedilir.

`GET /api/feeds`, mevcut tenant'in aboneliklerini `subscribed_at ASC, feed_id ASC` siralamasiyla doner. Response alanlari `feed_id`, `url`, `title`, `active` ve `subscribed_at` ile sinirlidir.

`DELETE /api/feeds/{feed_id}` yalnizca mevcut tenant'in abonelik iliskisini siler, `feeds` satirini silmez ve idempotent `204` doner.

## Validation

Validation hatalari `422` ve `{ "error_code": "VALIDATION_FAILED" }` ile doner. Malformed JSON framework tarafindan `400` olarak ele alinir.

- `POST` body object olmak zorundadir.
- `url` required string olmak zorundadir.
- Leading/trailing whitespace kabul edilmez.
- Yalnizca absolute `http:` ve `https:` URL'leri kabul edilir.
- Unknown body field reddedilir.
- Tenant override alanlari reddedilir: `site_client_id`, `siteClientId`, `tenant_id`, `tenantId`, `client_id`, `clientId`.
- `GET` ve `DELETE` query parametresi kabul etmez.
- `feed_id` strict pozitif PostgreSQL bigint decimal string olmak zorundadir.

## Transaction ve Concurrency

Abonelik ekleme ve silme PostgreSQL transaction icinde calisir. Feed satiri yoksa olusturulur; mevcut pasif feed abonelige acilmaz. `site_feeds` iliskisi `ON CONFLICT DO NOTHING` ile idempotent eklenir.

`feeds.subscriber_count` yalnizca yeni `site_feeds` satiri gercekten olustugunda artar. Silmede once tenant-scoped `site_feeds` satiri silinir; sayac yalnizca silinen satir varsa azaltilir. `subscriber_count` icin `GREATEST` ile sessiz maskeleme yapilmaz; sayac zaten sifirken silme sonucu iliski donerse invariant hatasi verilir.

Subscriber count sifirdan canlandiginda `next_check_at = now()`, `error_count = 0`, `etag = null` ve `last_modified = null` guncellenir.

## Tenant Izolasyonu

Request body, query, path, header veya database lookup ile tenant override yoktur. Controller tenant principal'i guard'in request uzerine yerlestirdigi immutable principal'dan okur; use-case katmani persistence adapter'a sadece `siteClientId` aktarir.

Listeleme ve silme sorgulari her zaman `(site_client_id, feed_id)` tenant scope'u ile calisir. Bir tenant'in silme istegi baska tenant'in aboneligini etkilemez.

## Sinirlar

MS-004 sunlari uygulamaz:

- tenant entry endpoint'leri,
- Agent API endpoint'leri,
- scheduler/job runner,
- cleanup,
- rate limiting,
- admin/frontend,
- schema migration,
- server-side feed URL network request, DNS, RSS parse veya MIME check.
