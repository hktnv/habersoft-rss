# Agent Heartbeat

## Kapsam

MS-009, authenticated Agent icin ilk production Agent endpoint'ini ekler:

```text
POST /agent/heartbeat
```

Endpoint yalniz liveness ve aggregate runtime metric current-state kaydi icindir. Feed scheduler state'i, event ledger veya data ingestion hatti degildir.

## Auth

Route `AgentKeyAuthGuard` ile korunur ve yalniz `X-Agent-Key` kabul eder. Tenant JWT bu route'u acmaz. Basarili auth sonunda identity yalniz `AgentPrincipal.agentId = default` degerinden gelir.

Body, path veya query icinde `agent_id` / `agentId` kabul edilmez.

## Request

Exact request body allowlist:

```json
{
  "status": "ok",
  "sent_at": "2026-06-17T02:05:00Z",
  "feeds_processed": 500,
  "errors_count": 2,
  "stale_check_results_dropped": 0,
  "stale_entries_dropped": 0
}
```

Validation:

- Unknown field reddedilir.
- `status` required non-empty stringtir; yeni enum icat edilmez ve deger normalize edilmez.
- `sent_at` required timezone-aware valid instanttir.
- `sent_at` icin feed-check `checked_at` age/future skew penceresi uygulanmaz.
- Counter alanlari non-negative PostgreSQL int32 degeridir.

Malformed JSON framework tarafindan `400` kalir. Authenticated invalid payload `422` ve mevcut safe validation envelope ile doner.

## Response

Success exact:

```json
{ "ok": true }
```

HTTP status `200`dir.

## Persistence

Accepted heartbeat tek bounded Prisma upsert ile yalniz `agent_runtime_status` tablosundaki MVP row'u olusturur veya gunceller:

```text
agent_id=default
```

Mapping:

- `last_heartbeat_sent_at`: payload `sent_at`
- `last_heartbeat_received_at`: server-owned captured receive time
- `updated_at`: ayni captured receive time
- `status` ve counter alanlari: payload snapshot degerleri

Counter'lar increment edilmez; her accepted heartbeat current-state snapshot'ini replace eder. Duplicate/retry event veya history row uretmez. Latest accepted HTTP arrival current-state snapshot'ini kazanir.

Offline hesabinin kaynagi bu milestone'da depolanan `last_heartbeat_received_at` degeridir; diagnostic/offline endpoint eklenmemistir.

## No Side Effect

Heartbeat asagidaki tablolara veya state'e yazmaz:

- `feeds`
- `entries`
- `entry_details`
- `site_feeds`
- `agent_feed_check_events`
- scheduler cursor/state
- Redis/JWKS/network/cache/session

Agent rate limiting veya Tenant rate limiting uygulanmaz.

## Test

```powershell
npm run test:agent-heartbeat
npm run test:db:agent-heartbeat
```

`test:agent-heartbeat` validation, use-case mapping, HTTP route/auth/validation precedence, route inventory ve worker boundary senaryolarini kapsar. `test:db:agent-heartbeat`, PostgreSQL create/update/duplicate/concurrency ve no-side-effect senaryolarini kapsar.
