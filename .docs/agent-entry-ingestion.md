# Agent Entry Ingestion

## Scope

MS-012 adds the authenticated Agent entry ingestion endpoint:

```text
POST /agent/entries
```

The endpoint accepts Agent-normalized RSS entries for one feed check and writes
the event ledger, new `entries`, `entry_details` for successful detail
extraction, and monotonic feed success state in one PostgreSQL transaction.

This endpoint does not implement feed-check-results outcomes for
`not_modified`, `no_new_entries`, or fetch errors. Those remain for MS-013.

## Auth

Route authentication uses `AgentKeyAuthGuard` and accepts only `X-Agent-Key`.
Tenant JWT credentials do not open the route. Missing, duplicate, malformed, or
wrong Agent key returns `401` before payload validation.

Agent/Tenant rate limiting is not applied.

## Request

Request body is strict. Unknown root, entry, or `detail_extraction` fields return
`422`.

Root fields:

```json
{
  "check_id": "01K8Z3ABCD0000000000000001",
  "feed_id": "35",
  "checked_at": "2026-06-20T10:00:00Z",
  "tier_attempted": 1,
  "feed_title": "Feed title",
  "response_etag": "\"etag\"",
  "response_last_modified": "Sat, 20 Jun 2026 10:00:00 GMT",
  "entries": []
}
```

Key validation rules:

- `check_id`: uppercase ULID, no lowercase normalization.
- `feed_id`: strict positive PostgreSQL bigint decimal string.
- `checked_at`: timezone-aware ISO instant.
- `tier_attempted`: `1` or `2`.
- `entries`: array length `1..100`.
- `guid`: string, trim-stable, code-point length `1..2048`.
- `url`: absolute `http` or `https` URL, trim-stable, max `2048` code points.
- `title`: required string, trim-stable, `1..500` code points.
- `summary`: nullable string, max `2000` code points.
- `images`: nullable array of at most `20` absolute `http` or `https` URLs.
- `videos`: nullable array of at most `5` absolute `http` or `https` URLs.
- `tags`: nullable array of at most `20` strings, each max `50` code points.
- `author`: nullable string, max `200` code points.
- `meta`: nullable object with at most `50` top-level string values, each max `500` code points.
- `detail_extraction`: required object.

`detail_extraction.status` values are `ok`, `timeout`, `playwright_failed`,
`blocked`, `empty_content`, `normalizer_rejected`, and
`skipped_budget_exceeded`.

`status = "ok"` requires non-null `detail`, non-null `attempted_at`, and null
`error_code`. Non-ok statuses require `detail = null`. `skipped_budget_exceeded`
requires `attempted_at = null`; all other statuses require non-null
`attempted_at`.

## Response

Success returns `200`:

```json
{
  "saved": 1,
  "idempotent_replay": false
}
```

Validation failures return `422` with `{ "error_code": "..." }`. The endpoint
uses `VALIDATION_FAILED`, `CHECKED_AT_TOO_OLD`, `CHECKED_AT_IN_FUTURE`, and
`CHECK_ID_PAYLOAD_MISMATCH`.

Malformed JSON returns `400`. Body over the route limit returns `413`.

## Idempotency

`agent_feed_check_events.check_id` is the idempotency key. If an existing event
has the same feed and `entries_found` outcome, the endpoint returns the stored
saved count with `idempotent_replay: true` and performs no new writes.

If the same `check_id` is already associated with another feed or outcome, the
endpoint returns `422 CHECK_ID_PAYLOAD_MISMATCH`.

The `checked_at` time window is validated before replay lookup.

## Persistence

New entries are inserted with `ON CONFLICT (feed_id, guid) DO NOTHING`. Duplicate
entries are not errors and are not counted in `saved`.

For inserted entries:

- `first_seen_at = checked_at`
- `has_detail = true` only when `detail_extraction.status = "ok"`
- `entry_details.detail_length = char_length(detail)` for ok details

Feed success state is updated only when current `last_checked_at` is null or not
newer than request `checked_at`. The update writes `last_checked_at`,
`last_http_status = 200`, `error_count = 0`, `next_check_at`, `etag`,
`last_modified`, optional non-null `feed_title`, and `last_new_entry_at` only
when at least one new entry was saved.

## Configuration

Only the API runtime requires:

```text
CHECKED_AT_MAX_FUTURE_SKEW_SECONDS=60
CHECKED_AT_MAX_AGE_SECONDS=900
```

Worker, migration, and fixture containers do not receive these variables.

## Test

```powershell
npm run test:agent-entries
npm run test:db:agent-entries
```

`test:agent-entries` covers validation, phase scheduling, use-case time-window
behavior, controller auth/validation precedence, worker boundary, and PostgreSQL
transaction/replay/feed-state scenarios.
