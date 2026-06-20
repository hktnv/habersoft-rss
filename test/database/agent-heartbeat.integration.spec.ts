import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentHeartbeatModule } from "../../src/agent-heartbeat/agent-heartbeat.module";
import { AGENT_HEARTBEAT_CLOCK } from "../../src/agent-heartbeat/agent-heartbeat.clock";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type RuntimeStatusRow = {
  readonly agent_id: string;
  readonly status: string;
  readonly last_heartbeat_sent_at: Date;
  readonly last_heartbeat_received_at: Date;
  readonly feeds_processed: number;
  readonly errors_count: number;
  readonly stale_check_results_dropped: number;
  readonly stale_entries_dropped: number;
  readonly updated_at: Date;
};

type CountRow = { readonly count: bigint };
type FeedStateRow = {
  readonly subscriber_count: number;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_checked_at: Date | null;
  readonly last_new_entry_at: Date | null;
  readonly last_http_status: number | null;
  readonly error_count: number | null;
  readonly next_check_at: Date | null;
};

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const runId = `ms009_${Date.now()}`;
const url = `https://ms009.example.test/${runId}/feed.xml`;
const serverTimes = [
  "2026-06-20T12:00:00.000Z",
  "2026-06-20T12:00:10.000Z",
  "2026-06-20T12:00:20.000Z",
  "2026-06-20T12:00:30.000Z",
  "2026-06-20T12:00:40.000Z",
  "2026-06-20T12:00:50.000Z",
  "2026-06-20T12:01:00.000Z",
  "2026-06-20T12:01:10.000Z",
  "2026-06-20T12:01:20.000Z",
  "2026-06-20T12:01:30.000Z",
  "2026-06-20T12:01:40.000Z",
  "2026-06-20T12:01:50.000Z"
].map((value) => new Date(value));

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for agent heartbeat database integration tests.");
  }

  return databaseUrl;
}

describe("agent heartbeat with PostgreSQL", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;
  let clockIndex = 0;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanup();
    await seedNoSideEffectRows();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        AgentHeartbeatModule
      ]
    })
      .overrideProvider(AGENT_HEARTBEAT_CLOCK)
      .useValue({
        now: jest.fn(() => {
          const value = serverTimes[clockIndex] ?? serverTimes[serverTimes.length - 1];
          clockIndex += 1;
          return value;
        })
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await database?.$disconnect();
  }, 30_000);

  it("creates the default current-state row from an authenticated heartbeat", async () => {
    const response = await postHeartbeat({
      status: "ok",
      sent_at: "2026-06-17T02:05:00Z",
      feeds_processed: 500,
      errors_count: 2,
      stale_check_results_dropped: 0,
      stale_entries_dropped: 1
    });
    const row = await runtimeStatus();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
    expect(row).toMatchObject({
      agent_id: "default",
      status: "ok",
      feeds_processed: 500,
      errors_count: 2,
      stale_check_results_dropped: 0,
      stale_entries_dropped: 1
    });
    expect(row?.last_heartbeat_sent_at.toISOString()).toBe("2026-06-17T02:05:00.000Z");
    expect(row?.last_heartbeat_received_at.toISOString()).toBe("2026-06-20T12:00:00.000Z");
    expect(row?.updated_at.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });

  it("updates the same row by replacing status and counters without incrementing", async () => {
    const response = await postHeartbeat({
      status: "degraded",
      sent_at: "2026-06-17T02:06:00+03:00",
      feeds_processed: 5,
      errors_count: 0,
      stale_check_results_dropped: 2,
      stale_entries_dropped: 3
    });
    const row = await runtimeStatus();
    const count = await runtimeStatusCount();

    expect(response.statusCode).toBe(200);
    expect(count).toBe(1n);
    expect(row?.status).toBe("degraded");
    expect(row?.feeds_processed).toBe(5);
    expect(row?.errors_count).toBe(0);
    expect(row?.stale_check_results_dropped).toBe(2);
    expect(row?.stale_entries_dropped).toBe(3);
    expect(row?.last_heartbeat_sent_at.toISOString()).toBe("2026-06-16T23:06:00.000Z");
    expect(row?.last_heartbeat_received_at.toISOString()).toBe("2026-06-20T12:00:10.000Z");
    expect(row?.updated_at.toISOString()).toBe("2026-06-20T12:00:10.000Z");
  });

  it("accepts old and future sent_at values when they are valid timezone-aware instants", async () => {
    const oldSentAt = await postHeartbeat({
      status: "old-clock",
      sent_at: "1999-01-01T00:00:00Z",
      feeds_processed: 1,
      errors_count: 1,
      stale_check_results_dropped: 1,
      stale_entries_dropped: 1
    });
    const futureSentAt = await postHeartbeat({
      status: "future-clock",
      sent_at: "2999-01-01T00:00:00Z",
      feeds_processed: 2,
      errors_count: 2,
      stale_check_results_dropped: 2,
      stale_entries_dropped: 2
    });

    expect(oldSentAt.statusCode).toBe(200);
    expect(futureSentAt.statusCode).toBe(200);
    expect((await runtimeStatus())?.status).toBe("future-clock");
  });

  it("keeps duplicate/retry and concurrent heartbeat writes to one current-state row", async () => {
    const duplicatePayload = {
      status: "retry",
      sent_at: "2026-06-17T02:07:00Z",
      feeds_processed: 7,
      errors_count: 1,
      stale_check_results_dropped: 0,
      stale_entries_dropped: 0
    };
    await postHeartbeat(duplicatePayload);
    await postHeartbeat(duplicatePayload);
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        postHeartbeat({
          status: `concurrent-${index}`,
          sent_at: "2026-06-17T02:08:00Z",
          feeds_processed: index,
          errors_count: index,
          stale_check_results_dropped: index,
          stale_entries_dropped: index
        })
      )
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(await runtimeStatusCount()).toBe(1n);
    expect(await eventCount()).toBe(1n);
  });

  it("does not mutate feed, entry, detail, subscription, or feed-check-event state", async () => {
    const before = await sideEffectSnapshot();

    const response = await postHeartbeat({
      status: "no-side-effect",
      sent_at: "2026-06-17T02:09:00Z",
      feeds_processed: 9,
      errors_count: 0,
      stale_check_results_dropped: 0,
      stale_entries_dropped: 0
    });
    const after = await sideEffectSnapshot();

    expect(response.statusCode).toBe(200);
    expect(after).toEqual(before);
  });

  async function postHeartbeat(payload: Record<string, unknown>) {
    return fastify.inject({
      method: "POST",
      url: "/agent/heartbeat",
      headers: { "X-Agent-Key": agentKey },
      payload
    });
  }

  async function runtimeStatus(): Promise<RuntimeStatusRow | undefined> {
    const rows = await database.$queryRaw<RuntimeStatusRow[]>`
      SELECT
        agent_id,
        status,
        last_heartbeat_sent_at,
        last_heartbeat_received_at,
        feeds_processed,
        errors_count,
        stale_check_results_dropped,
        stale_entries_dropped,
        updated_at
      FROM agent_runtime_status
      WHERE agent_id = 'default'
    `;

    return rows[0];
  }

  async function runtimeStatusCount(): Promise<bigint> {
    const rows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM agent_runtime_status
      WHERE agent_id = 'default'
    `;

    return rows[0]?.count ?? 0n;
  }

  async function eventCount(): Promise<bigint> {
    const rows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM agent_feed_check_events
      WHERE check_id = ${`${runId}-event`}
    `;

    return rows[0]?.count ?? 0n;
  }

  async function sideEffectSnapshot(): Promise<{
    readonly feed: FeedStateRow | undefined;
    readonly entries: bigint;
    readonly entryDetails: bigint;
    readonly siteFeeds: bigint;
    readonly events: bigint;
  }> {
    const feedRows = await database.$queryRaw<FeedStateRow[]>`
      SELECT
        subscriber_count,
        etag,
        last_modified,
        last_checked_at,
        last_new_entry_at,
        last_http_status,
        error_count,
        next_check_at
      FROM feeds
      WHERE url = ${url}
    `;
    const entryRows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM entries
      WHERE guid = ${`${runId}-guid`}
    `;
    const detailRows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM entry_details ed
      INNER JOIN entries e ON e.id = ed.entry_id
      WHERE e.guid = ${`${runId}-guid`}
    `;
    const siteFeedRows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM site_feeds
      WHERE site_client_id = ${`${runId}-site`}
    `;
    const eventRows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM agent_feed_check_events
      WHERE check_id = ${`${runId}-event`}
    `;

    return {
      feed: feedRows[0],
      entries: entryRows[0]?.count ?? 0n,
      entryDetails: detailRows[0]?.count ?? 0n,
      siteFeeds: siteFeedRows[0]?.count ?? 0n,
      events: eventRows[0]?.count ?? 0n
    };
  }

  async function seedNoSideEffectRows(): Promise<void> {
    const feedRows = await database.$queryRaw<{ readonly id: bigint }[]>`
      INSERT INTO feeds (
        url,
        active,
        subscriber_count,
        etag,
        last_modified,
        last_checked_at,
        last_new_entry_at,
        last_http_status,
        error_count,
        next_check_at,
        created_at
      )
      VALUES (
        ${url},
        true,
        1,
        'etag-before',
        'Tue, 17 Jun 2026 02:00:00 GMT',
        '2026-06-17T02:00:00Z'::timestamptz,
        '2026-06-17T02:00:00Z'::timestamptz,
        200,
        0,
        '2026-06-17T02:15:00Z'::timestamptz,
        now()
      )
      RETURNING id
    `;
    const feedId = feedRows[0]?.id;
    if (feedId === undefined) {
      throw new Error("failed_to_seed_ms009_feed");
    }

    await database.$executeRaw`
      INSERT INTO site_feeds (site_client_id, feed_id)
      VALUES (${`${runId}-site`}, ${feedId})
    `;

    const entryRows = await database.$queryRaw<{ readonly id: bigint; readonly effective_at: Date }[]>`
      INSERT INTO entries (
        feed_id,
        guid,
        url,
        title,
        published_at,
        first_seen_at,
        detail_extraction_status,
        detail_extraction_attempted_at,
        detail_extraction_finalized_at,
        has_detail,
        created_at
      )
      VALUES (
        ${feedId},
        ${`${runId}-guid`},
        ${`https://ms009.example.test/${runId}/entry`},
        'MS-009 entry',
        '2026-06-17T01:00:00Z'::timestamptz,
        '2026-06-17T02:00:00Z'::timestamptz,
        'ok',
        '2026-06-17T02:00:01Z'::timestamptz,
        '2026-06-17T02:00:02Z'::timestamptz,
        true,
        now()
      )
      RETURNING id, effective_at
    `;
    const entry = entryRows[0];
    if (entry === undefined) {
      throw new Error("failed_to_seed_ms009_entry");
    }

    await database.$executeRaw`
      INSERT INTO entry_details (entry_id, feed_id, effective_at, detail, detail_length, created_at)
      VALUES (${entry.id}, ${feedId}, ${entry.effective_at}, 'detail', 6, now())
    `;

    await database.$executeRaw`
      INSERT INTO agent_feed_check_events (
        check_id,
        feed_id,
        checked_at,
        http_status,
        outcome,
        entries_submitted_count,
        entries_saved_count,
        error_code,
        tier_attempted,
        created_at
      )
      VALUES (
        ${`${runId}-event`},
        ${feedId},
        '2026-06-17T02:00:00Z'::timestamptz,
        200,
        'no_new_entries',
        0,
        0,
        NULL,
        1,
        now()
      )
    `;
  }

  async function cleanup(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM agent_runtime_status
      WHERE agent_id = 'default'
    `;
    await database.$executeRaw`
      DELETE FROM agent_feed_check_events
      WHERE check_id = ${`${runId}-event`}
    `;
    await database.$executeRaw`
      DELETE FROM site_feeds
      WHERE site_client_id = ${`${runId}-site`}
    `;
    await database.$executeRaw`
      DELETE FROM entry_details
      WHERE entry_id IN (
        SELECT id
        FROM entries
        WHERE guid = ${`${runId}-guid`}
      )
    `;
    await database.$executeRaw`
      DELETE FROM entries
      WHERE guid = ${`${runId}-guid`}
    `;
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url = ${url}
    `;
  }
});
