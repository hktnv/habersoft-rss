# Agent New GUID Filtering

## Kapsam

MS-011, authenticated Agent icin read-only new-GUID filtering endpoint'ini ekler:

```text
POST /agent/feeds/{feed_id}/new-guids
```

Endpoint, Agent normalizer tarafindan RSS 200 response'undan uretilen `normalized_guid` listesini alir ve yalniz target feed icin `entries(feed_id, guid)` kimligiyle henuz saklanmamis GUID'leri dondurur.

Bu endpoint reservation, claim, lease, in-flight state, entry insert, scheduler advancement, feed-check-results, RSS fetch/parse veya Playwright enrichment uygulamasi degildir. Sonuc yalniz advisory database read sonucudur.

## Auth

Route `AgentKeyAuthGuard` ile korunur ve yalniz `X-Agent-Key` kabul eder. Tenant JWT bu route'u acmaz. Missing, duplicate, malformed veya wrong Agent key `401` dondurur ve path/body validation calismaz.

Agent/Tenant rate limiting uygulanmaz.

## Request Validation

Route:

```text
POST /agent/feeds/{feed_id}/new-guids
```

`feed_id` strict positive PostgreSQL `bigint` decimal string olmalidir. `0`, leading zero, sign, whitespace, decimal, exponent veya `9223372036854775807` ustu degerler reddedilir.

Body exact shape:

```json
{
  "guids": ["..."]
}
```

Validation kurallari:

- Body object'inde yalniz `guids` kabul edilir.
- Query parametresi kabul edilmez.
- `guids` array length `1..100` olmalidir.
- Her GUID string olmalidir; string coercion yoktur.
- Her GUID code-point length `1..2048` olmalidir.
- Leading/trailing whitespace reddedilir.
- Sunucu GUID uretmez, trim etmez, lowercase yapmaz, URL normalize etmez veya Unicode normalize etmez.
- GUID URL olabilir ama olmak zorunda degildir.

Invalid authenticated request `422` ve `{ "error_code": "VALIDATION_FAILED" }` dondurur. Unknown feed de all-new kabul edilmez; `422` dondurur.

## Response

Success her zaman `200` ve canonical object shape dondurur:

```json
{
  "new": ["guid-a", "guid-b"]
}
```

Tum unique GUID'ler target feed'de zaten varsa normal success response:

```json
{
  "new": []
}
```

Response'a reservation token, claim token, lease metadata, count, cursor, rate-limit metadata, feed state veya scheduler state eklenmez.

## Duplicate and Order Policy

Input duplicate GUID'ler deterministic olarak first occurrence order ile tekillestirilir. Database filter yalniz unique first-occurrence liste uzerinde calisir. Response yine request first-occurrence order'ini korur ve yalniz target feed'de absent olan GUID'leri icerir.

Ayni GUID baska feed'de varsa target feed icin existing sayilmaz.

## Database Filter

Reader iki bounded Prisma read'i yapar:

1. `Feed.findUnique({ id })`, unknown feed'i all-new'e cevirmemek icin.
2. `Entry.findMany({ feedId, guid in uniqueGuids })`, target feed'de existing GUID set'ini okumak icin.

Selected fields minimum tutulur: feed varligi icin `id`, entry filter icin `guid`.

`entries_feed_id_guid_key` composite unique constraint'i `(feed_id, guid)` identity ve future write idempotency otoritesidir. Bu endpoint `COUNT(*)`, per-GUID query, relation include, raw unsafe SQL, transaction lock, `FOR UPDATE`, `SKIP LOCKED`, advisory lock veya mutation kullanmaz.

## Advisory Idempotency

Ayni request entry insert edilmeden once tekrar edilirse ayni `new` listesi donebilir. Future `/agent/entries` hattindan sonra kismen insert edilmis GUID'ler response'tan duser ve ordered subset doner. Concurrent requests ayni absent GUID'i ayni anda `new` gorebilir.

Nihai write idempotency bu endpoint'te degildir. Otorite MS-012 `POST /agent/entries` hattindaki:

```text
UNIQUE (feed_id, guid)
INSERT ... ON CONFLICT DO NOTHING
```

siniridir.

## No Side Effects

Endpoint su state'leri degistirmez:

- `feeds`
- `entries`
- `entry_details`
- `site_feeds`
- `agent_feed_check_events`
- `agent_runtime_status`
- Redis, JWKS, network veya queue state

Feed active/subscriber/next_check_at degerleri new/existing filtresi degildir. Existing identity yalniz target `(feed_id, guid)` uzerindendir.

## Worker Boundary

`AgentNewGuidsModule` yalniz API graph'ina import edilir. Worker HTTP listener acmaz ve Agent auth, heartbeat, due-feed veya new-GUID module lifecycle'i baslatmaz.

## Test

```powershell
npm run test:agent-new-guids
npm run test:db:agent-new-guids
```

`test:agent-new-guids`, validation, mapper, use-case, controller auth/validation precedence, worker boundary ve PostgreSQL filter/no-mutation/query-count/query-plan senaryolarini kapsar. Host ortaminda `DATABASE_URL=postgres:5432` Compose DNS'i cozulemediginde integration kismi container icinde authoritative olarak calistirilir.
