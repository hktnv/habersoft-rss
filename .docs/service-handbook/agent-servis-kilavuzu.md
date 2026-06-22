# Agent Servis Kilavuzu

## Agent'in rolu

Agent, dis dunyadaki RSS kaynaklariyla main-service arasindaki adapter'dir. Server hangi feed'lerin due oldugunu soyler; Agent feed'i disarida fetch eder, normalize eder ve sonucu main-service'e bildirir.

Agent canonical feed katalogu sahibi degildir. Veritabanina dogrudan baglanmaz.

## Authentication with X-Agent-Key

Agent route'lari yalniz `X-Agent-Key` header'i ile acilir. Missing, duplicate, malformed veya wrong key `401` doner.

`X-Agent-Key`, Tenant route'larini acmaz. Tenant JWT de Agent route'larini acmaz.

## Server-owned scheduling

Server `feeds.next_check_at` alaninin sahibidir. Agent due listeyi okur ama lease, reservation veya claim almaz. Ayni due feed tekrar gorulebilir; bu recovery davranisidir.

## Due-feed flow

Agent once due feed listesini alir:

```text
GET /agent/feeds/due
```

Sonra feed'i dis dunyada fetch eder ve normalize eder. Due endpoint read-only kalir; feed state'i burada degismez.

## New-GUID advisory flow

Agent, elindeki candidate GUID listesini server'a danisabilir:

```text
POST /agent/feeds/{feed_id}/new-guids
```

Bu endpoint advisory'dir. State yazmaz, canonical ingestion yerine gecmez.

## Entry ingestion flow

Entry ureten basarili feed check sonucu:

```text
POST /agent/entries
```

Bu endpoint event ledger, yeni `entries`, gerekirse `entry_details` ve feed success state'ini tek transaction icinde yazar.

## Non-entry feed-check-results flow

Entry uretmeyen sonuclar:

```text
POST /agent/feed-check-results
```

`not_modified`, `no_new_entries` ve `fetch_error` sonuclari burada kaydedilir. Entry tasiyan payload bu endpoint'in isi degildir.

## Heartbeat

Agent current runtime durumunu bildirir:

```text
POST /agent/heartbeat
```

Bu kayit `agent_runtime_status` icinde latest-state olarak tutulur.

## Idempotency

Agent feed check sonuclarinda `check_id` idempotency anahtaridir. Ayni feed ve ayni outcome ile tekrar gelirse replay olarak ele alinir. Ayni `check_id` baska feed veya baska outcome ile gelirse request reddedilir.

`checked_at` window'u server tarafinda sinirlanir.

## Retry expectations

Agent network veya fetch hatasindan sonra sonucu `feed-check-results` ile bildirmelidir. Server out-of-order sonuclari event olarak kaydedebilir ama daha yeni feed state'i varsa state'i geri almaz.

At-least-once gonderim modeli beklenir; idempotency bu yuzden vardir.

## Agent must never do

Agent DB connection kullanmaz, Redis/BullMQ state'ine baglanmaz, canonical feed katalogu tutmaz, `next_check_at` sahibi olmaz, Tenant route'larini cagirmak icin Agent key kullanmaz, staging key'i production'da kullanmaz ve synthetic production business data olusturmaz.

## Integration checklist

- `X-Agent-Key` yalniz secure operator kanaliyla alinmis olmali.
- `GET /agent/feeds/due` icin strict `limit` kullanilmali.
- Fetch/normalize dis dunyada yapilmali.
- Entry varsa `POST /agent/entries`, entry yoksa `POST /agent/feed-check-results` kullanilmali.
- Heartbeat duzenli gonderilmeli.
- Retry ayni `check_id` ile idempotent kalmali.
- Tenant JWT veya Tenant API Agent flow'una karistirilmamali.

## Detailed references

- [../agent-authentication.md](../agent-authentication.md)
- [../agent-due-feeds.md](../agent-due-feeds.md)
- [../agent-new-guid-filtering.md](../agent-new-guid-filtering.md)
- [../agent-entry-ingestion.md](../agent-entry-ingestion.md)
- [../agent-feed-check-results.md](../agent-feed-check-results.md)
- [../agent-heartbeat.md](../agent-heartbeat.md)
