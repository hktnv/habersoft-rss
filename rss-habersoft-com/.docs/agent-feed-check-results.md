# Agent Feed Check Results

## Scope

MS-013 adds the authenticated Agent feed-check-results endpoint:

```text
POST /agent/feed-check-results
```

The endpoint records non-entry feed check outcomes for existing feeds and updates feed state in one PostgreSQL transaction. It covers `not_modified`, `no_new_entries`, and `fetch_error`; entry-producing checks remain handled by `POST /agent/entries`.

This endpoint does not fetch feeds, parse RSS, filter GUIDs, insert entries, run cleanup, enqueue jobs, or implement a scheduler.

## Auth

Route authentication uses `AgentKeyAuthGuard` and accepts only `X-Agent-Key`. Tenant JWT credentials do not open the route. Missing, duplicate, malformed, or wrong Agent key returns `401` before payload validation.

Agent/Tenant rate limiting is not applied.

## Request

Request body is strict. Unknown root or result fields return `422`.

Root fields:

```json
{
  "flush_id": "agent-flush-1",
  "sent_at": "2026-06-20T10:00:05Z",
  "results": []
}
```

`flush_id` and `sent_at` are accepted correlation fields only; they are not persisted.

Each result accepts:

```json
{
  "check_id": "01K8Z3ABCD0000000000000001",
  "feed_id": "35",
  "checked_at": "2026-06-20T10:00:00Z",
  "outcome": "no_new_entries",
  "http_status": 200,
  "tier_attempted": 1,
  "response_etag": "\"etag\"",
  "response_last_modified": "Sat, 20 Jun 2026 10:00:00 GMT",
  "feed_title": "Feed title",
  "error_code": null
}
```

Key validation rules:

- `results`: array length `1..250`.
- `check_id`: uppercase ULID, no lowercase normalization.
- `feed_id`: strict positive PostgreSQL bigint decimal string.
- `checked_at`: timezone-aware ISO instant.
- `outcome`: `not_modified`, `no_new_entries`, or `fetch_error`.
- `tier_attempted`: `1` or `2`.
- `http_status`: integer `0..599`; `not_modified` requires `304`, `no_new_entries` requires `200`, and `fetch_error` cannot use `304`.
- `error_code`: required non-empty string for `fetch_error`; must be `null` for success outcomes.
- `response_etag`: absent for `fetch_error`; optional nullable string for `not_modified`; required nullable string for `no_new_entries`.
- `response_last_modified`: absent for `fetch_error`; optional nullable string for `not_modified`; required nullable string for `no_new_entries`.
- `feed_title`: optional nullable value; non-null title is accepted only for `no_new_entries`, must be trim-stable, and must have length `1..300`.

`checked_at` is validated against the same API runtime window as Agent entry ingestion: at most `60` seconds in the future and at most `900` seconds old.

## Response

Success returns `200`:

```json
{
  "accepted": 3,
  "feed_state_updated": 2,
  "idempotent_replay_count": 1,
  "out_of_order_result_count": 0
}
```

Response fields are exact:

- `accepted`: number of submitted result records accepted by the batch contract.
- `feed_state_updated`: count of new results that advanced or confirmed feed state.
- `idempotent_replay_count`: count of existing or in-batch compatible check replays.
- `out_of_order_result_count`: count of new results whose event was recorded but whose feed state was skipped because the feed already had a newer `last_checked_at`.

Validation failures return `422` with `{ "error_code": "..." }`. The endpoint uses `VALIDATION_FAILED`, `FEED_CHECK_RESULTS_EMPTY`, `CHECKED_AT_TOO_OLD`, `CHECKED_AT_IN_FUTURE`, and `CHECK_ID_PAYLOAD_MISMATCH`.

Malformed JSON returns `400`. Body over the route limit returns `413`.

## Idempotency and Ordering

`agent_feed_check_events.check_id` is the idempotency key. If an existing event has the same feed and outcome, the endpoint counts it as `idempotent_replay_count` and performs no feed-state write for that result.

If the same `check_id` is already associated with another feed or outcome, the endpoint returns `422 CHECK_ID_PAYLOAD_MISMATCH` and rolls back the whole batch.

Duplicate compatible `check_id` values inside one request are treated as in-batch idempotent replays after the first occurrence. Incompatible duplicates fail the whole batch.

New stale results still write an immutable event record. Feed state updates are monotonic and apply only when current `last_checked_at` is null or not newer than result `checked_at`; otherwise the result increments `out_of_order_result_count`.

## Persistence

The whole batch runs in one PostgreSQL transaction. Unknown feeds, check-id mismatches, and write conflicts roll back event and feed-state writes for the entire request.

New event rows are inserted into `agent_feed_check_events` with zero entry counters and the submitted non-entry outcome metadata.

Feed state behavior:

- `not_modified`: writes `last_checked_at`, `last_http_status = 304`, `error_count = 0`, `next_check_at`, and only non-null validator values.
- `no_new_entries`: writes `last_checked_at`, `last_http_status = 200`, `error_count = 0`, `next_check_at`, validator values including nulls, and optional non-null `feed_title`.
- `fetch_error`: writes `last_checked_at`, submitted non-304 `last_http_status`, increments `error_count`, and schedules exponential retry backoff capped at exponent `6`.

Success outcomes use the same phase-slot scheduling policy as Agent entry ingestion.

## Configuration

Only the API runtime requires:

```text
CHECKED_AT_MAX_FUTURE_SKEW_SECONDS=60
CHECKED_AT_MAX_AGE_SECONDS=900
```

Worker, migration, and fixture containers do not receive these variables.

## Worker Boundary

`AgentFeedCheckResultsModule` is imported only by the API module graph. Worker HTTP listener does not start and the worker does not import the module.

## Test

```powershell
npm run test:agent-feed-check-results
npm run test:db:agent-feed-check-results
```

`test:agent-feed-check-results` covers validation, scheduling policy, use-case time-window behavior, controller auth/validation precedence, worker boundary, and PostgreSQL transaction/replay/out-of-order/feed-state scenarios.
