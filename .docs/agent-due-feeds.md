# Agent Due Feeds

## Kapsam

MS-010, authenticated Agent icin read-only due-feed endpoint'ini ekler:

```text
GET /agent/feeds/due?limit=<AGENT_DUE_FETCH_LIMIT>
```

Endpoint Agent icin is listesi dondurur. Claim, lease, reservation, in-flight state, scheduler runner veya feed fetch/RSS parse uygulamasi degildir.

## Auth

Route `AgentKeyAuthGuard` ile korunur ve yalniz `X-Agent-Key` kabul eder. Tenant JWT bu route'u acmaz. Missing, duplicate, malformed veya wrong Agent key `401` dondurur ve query validation calismaz.

Agent/Tenant rate limiting uygulanmaz.

## Query Validation

`limit` zorunludur. Accepted aralik:

```text
1..500
```

Validation kurallari:

- Query object'inde yalniz `limit` kabul edilir.
- `limit` exactly one string value olmalidir.
- ASCII decimal digit string olmalidir.
- Leading zero, whitespace, sign, decimal point, exponent, empty string, array/repeated value ve unknown query parametreleri reddedilir.
- Invalid authenticated query `422` ve `{ "error_code": "VALIDATION_FAILED" }` dondurur.
- Deger clamp edilmez; `limit=501` fail-fast `422` olur.

## Response

Success her zaman `200` ve canonical object shape dondurur:

```json
{
  "feeds": [
    {
      "feed_id": "35",
      "url": "https://www.ntv.com.tr/gundem.rss",
      "etag": "\"abc123\"",
      "last_modified": "Tue, 17 Jun 2026 01:00:00 GMT"
    }
  ],
  "feed_poll_interval_seconds": 900,
  "has_more_due": false
}
```

Empty result `204` veya `404` degildir:

```json
{
  "feeds": [],
  "feed_poll_interval_seconds": 900,
  "has_more_due": false
}
```

`feed_id`, PostgreSQL `bigint` kimliginin decimal string projeksiyonudur. `etag` ve `last_modified`, DB'deki exact nullable string degerleridir; parse, quote-strip, normalize veya Date formatlama yapilmaz.

Response'a `active`, `subscriber_count`, `next_check_at`, `last_checked_at`, `last_http_status`, `error_count`, tenant bilgisi, preferred tier, claim token, cursor, count veya rate-limit metadata eklenmez.

## Due Query

Tek request icin server time use-case girisinde bir kez capture edilir. Eligibility:

```text
active = true
subscriber_count > 0
next_check_at <= captured server now
```

`site_feeds` join/EXISTS kullanilmaz. Query canonical order ile calisir:

```text
next_check_at ASC, id ASC
```

Reader tek Prisma `findMany` read'i yapar:

- `where`: `active=true`, `subscriberCount > 0`, `nextCheckAt <= serverNow`
- `orderBy`: `nextCheckAt asc`, `id asc`
- `take`: `limit + 1`
- `select`: `id`, `url`, `etag`, `lastModified`

`has_more_due`, ayni read snapshot'indaki candidate sayisi requested `limit` degerinden buyukse `true` olur. Separate `COUNT(*)`, `EXISTS`, cursor veya offset yoktur.

## Read-Only Recovery

Endpoint su state'leri degistirmez:

- `feeds.next_check_at`
- `feeds.last_checked_at`
- `feeds.last_http_status`
- `feeds.error_count`
- `feeds.etag`
- `feeds.last_modified`
- `agent_runtime_status`
- `agent_feed_check_events`
- Redis veya queue state

`FOR UPDATE`, `SKIP LOCKED`, advisory lock, claim, lease, reservation veya in-flight flag yoktur. Downstream ACK endpoint'leri bu surumde olmadigi icin ayni due feed arka arkaya veya concurrent due read'lerde yeniden gorulebilir; bu recovery davranisidir.

## Worker Boundary

`AgentDueFeedsModule` yalniz API graph'ina import edilir. Worker HTTP listener acmaz ve Agent auth, heartbeat veya due-feed module lifecycle'i baslatmaz.

## Test

```powershell
npm run test:agent-due-feeds
npm run test:db:agent-due-feeds
```

`test:agent-due-feeds`, validation, mapper, use-case, controller auth/validation precedence, route boundary, worker boundary ve PostgreSQL eligibility/order/limit/no-mutation senaryolarini kapsar. `test:db:agent-due-feeds`, Compose PostgreSQL uzerinde due query davranisini ve `feeds_due` index uyumunu kanitlar.
