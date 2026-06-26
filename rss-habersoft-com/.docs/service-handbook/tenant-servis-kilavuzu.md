# Tenant Servis Kilavuzu

## Tenant model

Tenant client, main-service'in public Tenant API'sini kullanan authenticated consumer'dir. Tenant kimligi token icindeki canonical client id'den gelir.

Request body, query veya path tenant kimligini genisletemez ya da override edemez.

## JWT/JWKS authentication

Tenant route'lari su header'i bekler:

```text
Authorization: Bearer <JWT>
```

API token'i local olarak RS256/JWKS ile dogrular. Request basina auth-service introspection yapmaz.

## Required issuer/audience/scope

Current production auth contract:

```text
issuer: https://auth.habersoft.com
audience includes: rss.habersoft.com
scope includes: services:access
algorithm: RS256
sub == client_id
```

Token minting `auth.habersoft.com` tarafindan sahiplenilir; main-service token mint etmez.

## Tenant identity source

Basarili auth sonunda request'e immutable tenant principal eklenir. `siteClientId`, token `sub` degeridir. `client_id` claim'i `sub` ile birebir ayni olmalidir.

## Tenant isolation

Tenant visibility `site_feeds.site_client_id` uzerinden uygulanir. Bir tenant baska tenant'in feed aboneligini, entry listesini veya detail gorunurlugunu body/path/query ile genisletemez.

Auth hatalari rate-limit kotasini tuketmez. Auth basarili olduktan sonraki validation ve is sonuclari tenant-wide Redis bucket'ini kullanir.

## Feed subscription endpoints

```text
POST /api/feeds
GET /api/feeds
DELETE /api/feeds/{feed_id}
```

Feed URL'i main-service tarafinda network fetch veya RSS parse edilmeden kaydedilir. `DELETE`, tenant abonelik iliskisini kaldirir; global feed satirini silmez.

## Entry list endpoint

```text
GET /api/entries
```

Endpoint tenant'in halen abone oldugu feed'lerden retained entry listesini dondurur. Response bare JSON array'dir; total count veya page envelope yoktur.

## Entry detail endpoint

```text
GET /api/entries/{id}/detail
```

Gorunur entry ve aktif detail varsa detail doner. Entry yoksa, tenant abone degilse veya entry baska tenant icinse public sonuc generic `404` olur.

## Rate limiting

Tenant feed ve entry route'lari tenant basina Redis rate-limit guard'i kullanir. Agent route'lari bu Tenant rate-limit bucket'ini kullanmaz.

## Common response/error behavior

- Missing veya malformed Tenant token: `401`.
- Gecerli token ama required scope yok: `403`.
- Tenant auth karar veremeyecek durumdaysa: `503`.
- Validation hatasi: `422` ve safe error code.
- Body cok buyukse ilgili route `413` donebilir.

HTTP response'lar token, secret, JWKS credential'i veya altyapi detayi dondurmez.

## Integration checklist

- Token `auth.habersoft.com` tarafindan alinmali.
- `aud` icinde `rss.habersoft.com` bulunmali.
- `scope` icinde `services:access` bulunmali.
- `sub` ve `client_id` ayni tenant identity olmasi beklenmeli.
- Tenant identity request body/query/path icine yazilmamali.
- Feed subscription, entry list ve detail endpoint'leri sadece public Tenant API uzerinden kullanilmali.

## Token acquisition boundary

Token acquisition main-service'in sorumlulugu degildir. Integrator, auth-service contract'ini kendi client sinirinda uygular ve main-service'e yalniz Bearer JWT gonderir.

## Detailed references

- [../tenant-authentication.md](../tenant-authentication.md)
- [../tenant-feed-subscriptions.md](../tenant-feed-subscriptions.md)
- [../tenant-rate-limiting.md](../tenant-rate-limiting.md)
- [../tenant-entry-listing.md](../tenant-entry-listing.md)
- [../tenant-entry-detail.md](../tenant-entry-detail.md)
