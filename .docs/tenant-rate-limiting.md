# Tenant Rate Limiting

## Kapsam

MS-005, mevcut Tenant API feed rotalarina tenant basina Redis rate limiting uygular. MS-006 ile ayni tenant bucket'i entry listeleme rotasi tarafindan da kullanilir:

- `POST /api/feeds`
- `GET /api/feeds`
- `DELETE /api/feeds/{feed_id}`
- `GET /api/entries`

Entry detail endpoint'i, Agent API endpoint'i, scheduler/job runner, cleanup veya database migration eklenmez.

## Kimlik ve Guard Sirasi

Tenant kimligi yalnizca `TenantJwtAuthGuard` tarafindan dogrulanmis `TenantPrincipal.siteClientId` alanindan alinir.

Guard sirasi:

1. `TenantJwtAuthGuard`
2. tenant rate-limit guard
3. controller

401/403/503 tenant auth hatalari kota tuketmez. Auth basarili olduktan sonra controller validation veya domain sonucu 422/409/2xx olsa da istek kota tuketir.

## Kota Politikasi

Tum kapsamdaki Tenant API feed rotalari ve entry listeleme rotasi ayni tenant genisligindeki kovayi paylasir. Global, IP, route, method, token veya jti bazli kota yoktur.

Local varsayilan:

- `TENANT_RATE_LIMIT_MAX_REQUESTS=60`
- `TENANT_RATE_LIMIT_WINDOW_SECONDS=60`
- `TENANT_RATE_LIMIT_REDIS_PREFIX=tenant_rate_limit:local`
- `TENANT_RATE_LIMIT_KEY_SECRET=replace_with_local_only_rate_limit_key_secret_32`

Production ortaminda rate-limit config degerleri acik verilmelidir. Local placeholder secret production'da reddedilir.

## Redis Davranisi

Sayaç Redis 8.8 `INCREX` komutu ile atomik artirilir:

```text
INCREX <key> BYINT 1 EX <window_seconds> ENX
```

`ENX`, mevcut pencerenin TTL'inin yeniden uzatilmasini engeller. Redis anahtarinda ham tenant kimligi bulunmaz; tenant kimligi HMAC-SHA256 ile psodonimlestirilir.

Redis veya rate-limit altyapisi karar veremeyecek durumdaysa istek fail-closed `503` ile sonlanir. Bellek ici fallback yoktur.

## HTTP Semantigi

Limit asildiginda response `429` olur ve `Retry-After` header'i pozitif tamsayi olarak doner.

Rate-limit response'lari `X-RateLimit-*`, `RateLimit-*` veya yeni public `error_code` uretmez. 429/503 durumlari controller, use-case ve database katmanina ulasmadan sonlanir.

## Health ve Worker Siniri

`/health/live` ve `/health/ready` kota tuketmez. Readiness Redis'in mevcut dependency durum semantigini korur; tenant rate-limit icin ayri public readiness detayi eklenmez.

Worker process'i tenant rate-limit modulunu veya Redis `INCREX` capability check'ini baslatmaz.

## Dogrulama

Rate-limit testleri:

```powershell
npm run test:rate-limit
```

Compose icinde bu script Redis entegrasyon senaryolarini da calistirir: tenant izolasyonu, concurrency altinda exact limit, multi-instance shared kota, pencere expiry ve reject sirasinda TTL uzatilmamasi.
