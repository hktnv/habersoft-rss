import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { AgentFeedCheckResultsModule } from "../../src/agent-feed-check-results/agent-feed-check-results.module";
import { failureBackoffAfter, nextPhaseSlotAfter } from "../../src/agent-feed-check-results/agent-feed-check-results.policy";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { PostgresService } from "../../src/persistence/postgres.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type FeedRow = {
  readonly id: bigint;
  readonly created_at: Date;
};
type FeedStateRow = {
  readonly title: string | null;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_checked_at: Date | null;
  readonly last_new_entry_at: Date | null;
  readonly last_http_status: number | null;
  readonly error_count: number | null;
  readonly next_check_at: Date | null;
};
type EventRow = {
  readonly check_id: string;
  readonly feed_id: bigint | null;
  readonly checked_at: Date | null;
  readonly http_status: number | null;
  readonly outcome: string;
  readonly entries_submitted_count: number;
  readonly entries_saved_count: number;
  readonly error_code: string | null;
  readonly tier_attempted: number;
  readonly response_etag: string | null;
  readonly response_last_modified: string | null;
  readonly feed_title: string | null;
};

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const runId = `ms013_${Date.now()}`;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for agent feed-check-results database integration tests.");
  }

  return databaseUrl;
}

describe("agent feed-check-results with PostgreSQL", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;
  let notModifiedFeed: FeedRow;
  let noNewFeed: FeedRow;
  let fetchErrorFeed: FeedRow;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanup();
    notModifiedFeed = await insertFeed("not-modified");
    noNewFeed = await insertFeed("no-new");
    fetchErrorFeed = await insertFeed("fetch-error", 0);

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        AgentFeedCheckResultsModule
      ]
    })
      .overrideProvider(PostgresService)
      .useValue({
        database: jest.fn(() => database),
        check: jest.fn().mockResolvedValue("up")
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

  it("writes non-entry events and updates feed state by outcome", async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const response = await postResults({
      results: [
        notModified(checkId(1), notModifiedFeed.id, checkedAt),
        noNew(checkId(2), noNewFeed.id, checkedAt),
        fetchError(checkId(3), fetchErrorFeed.id, checkedAt)
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      accepted: 3,
      feed_state_updated: 3,
      idempotent_replay_count: 0,
      out_of_order_result_count: 0
    });

    expect(await eventRow(checkId(1))).toEqual(
      expect.objectContaining({
        feed_id: notModifiedFeed.id,
        outcome: "not_modified",
        entries_submitted_count: 0,
        entries_saved_count: 0,
        error_code: null,
        response_etag: '"nm-etag"'
      })
    );
    expect(await eventRow(checkId(2))).toEqual(
      expect.objectContaining({
        feed_id: noNewFeed.id,
        outcome: "no_new_entries",
        response_etag: null,
        response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
        feed_title: "No New Title"
      })
    );
    expect(await eventRow(checkId(3))).toEqual(
      expect.objectContaining({
        feed_id: fetchErrorFeed.id,
        outcome: "fetch_error",
        error_code: "HTTP_403"
      })
    );

    const notModifiedState = await feedState(notModifiedFeed.id);
    expect(notModifiedState).toEqual(
      expect.objectContaining({
        etag: '"nm-etag"',
        last_modified: "previous-last-modified",
        last_http_status: 304,
        error_count: 0
      })
    );
    expect(notModifiedState?.next_check_at?.toISOString()).toBe(
      nextPhaseSlotAfter(checkedAt, notModifiedFeed.id, notModifiedFeed.created_at).toISOString()
    );

    const noNewState = await feedState(noNewFeed.id);
    expect(noNewState).toEqual(
      expect.objectContaining({
        title: "No New Title",
        etag: null,
        last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
        last_http_status: 200,
        error_count: 0
      })
    );

    const fetchErrorState = await feedState(fetchErrorFeed.id);
    expect(fetchErrorState).toEqual(
      expect.objectContaining({
        last_http_status: 403,
        error_count: 1,
        etag: "previous-etag",
        last_modified: "previous-last-modified",
        title: `Feed fetch-error ${runId}`
      })
    );
    expect(fetchErrorState?.next_check_at?.toISOString()).toBe(failureBackoffAfter(checkedAt, 1).toISOString());
    expect(fetchErrorState?.last_new_entry_at).toBeNull();
  });

  it("classifies replay and new out-of-order results separately", async () => {
    const newerCheckedAt = new Date(Date.now() - 10_000);
    const oldCheckedAt = new Date(Date.now() - 120_000);
    await database.feed.update({
      where: { id: noNewFeed.id },
      data: {
        lastCheckedAt: newerCheckedAt,
        nextCheckAt: new Date(Date.now() + 300_000),
        etag: "newer-etag",
        lastModified: "newer-last-modified",
        title: "Newer title",
        errorCount: 0
      }
    });
    const before = await feedState(noNewFeed.id);

    const first = await postResults({ results: [noNew(checkId(4), noNewFeed.id, oldCheckedAt)] });
    const second = await postResults({ results: [noNew(checkId(4), noNewFeed.id, oldCheckedAt)] });

    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.payload)).toEqual({
      accepted: 1,
      feed_state_updated: 0,
      idempotent_replay_count: 0,
      out_of_order_result_count: 1
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload)).toEqual({
      accepted: 1,
      feed_state_updated: 0,
      idempotent_replay_count: 1,
      out_of_order_result_count: 0
    });
    expect(await feedState(noNewFeed.id)).toEqual(before);
    expect(await eventCount(checkId(4))).toBe(1);
  });

  it("returns exact mixed counters for updated, replay, and out-of-order in one batch", async () => {
    const checkedAt = new Date(Date.now() - 80_000);
    const currentNoNewFeed = await insertFeed("mixed-no-new");
    await postResults({ results: [notModified(checkId(5), notModifiedFeed.id, checkedAt)] });
    await database.feed.update({
      where: { id: fetchErrorFeed.id },
      data: { lastCheckedAt: new Date(Date.now() - 5_000) }
    });

    const response = await postResults({
      results: [
        noNew(checkId(6), currentNoNewFeed.id, new Date(Date.now() - 30_000)),
        notModified(checkId(5), notModifiedFeed.id, checkedAt),
        fetchError(checkId(7), fetchErrorFeed.id, new Date(Date.now() - 90_000))
      ]
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      accepted: 3,
      feed_state_updated: 1,
      idempotent_replay_count: 1,
      out_of_order_result_count: 1
    });
  });

  it("rolls back the whole batch for an unknown feed or check-id mismatch", async () => {
    const unknown = await postResults({
      results: [notModified(checkId(8), 9223372036854775807n, new Date(Date.now() - 60_000))]
    });
    expect(unknown.statusCode).toBe(422);
    await expect(eventCount(checkId(8))).resolves.toBe(0);

    const mismatch = await postResults({ results: [fetchError(checkId(5), fetchErrorFeed.id, new Date(Date.now() - 50_000))] });
    expect(mismatch.statusCode).toBe(422);
    expect(JSON.parse(mismatch.payload)).toMatchObject({ error_code: "CHECK_ID_PAYLOAD_MISMATCH" });
  });

  async function postResults(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return fastify.inject({
      method: "POST",
      url: "/agent/feed-check-results",
      headers: { "X-Agent-Key": agentKey },
      payload: body
    });
  }

  async function insertFeed(label: string, errorCount = 3): Promise<FeedRow> {
    const rows = await database.$queryRaw<FeedRow[]>`
      INSERT INTO feeds (
        url,
        title,
        active,
        subscriber_count,
        etag,
        last_modified,
        error_count,
        next_check_at,
        created_at
      )
      VALUES (
        ${`https://example.test/${runId}/${label}.rss`},
        ${`Feed ${label} ${runId}`},
        true,
        1,
        'previous-etag',
        'previous-last-modified',
        ${errorCount},
        NOW() - INTERVAL '1 minute',
        NOW() - INTERVAL '1 day'
      )
      RETURNING id, created_at
    `;

    return rows[0] as FeedRow;
  }

  async function feedState(feedId: bigint): Promise<FeedStateRow | null> {
    const rows = await database.$queryRaw<FeedStateRow[]>`
      SELECT title, etag, last_modified, last_checked_at, last_new_entry_at, last_http_status, error_count, next_check_at
      FROM feeds
      WHERE id = ${feedId}
    `;
    return rows[0] ?? null;
  }

  async function eventRow(checkIdValue: string): Promise<EventRow | null> {
    const rows = await database.$queryRaw<EventRow[]>`
      SELECT check_id, feed_id, checked_at, http_status, outcome, entries_submitted_count, entries_saved_count,
             error_code, tier_attempted, response_etag, response_last_modified, feed_title
      FROM agent_feed_check_events
      WHERE check_id = ${checkIdValue}
    `;
    return rows[0] ?? null;
  }

  async function eventCount(checkIdValue: string): Promise<number> {
    const rows = await database.$queryRaw<{ readonly count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM agent_feed_check_events
      WHERE check_id = ${checkIdValue}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function cleanup(): Promise<void> {
    if (database === undefined) {
      return;
    }

    await database.$executeRaw`DELETE FROM agent_feed_check_events WHERE check_id LIKE '01MS13%'`;
    await database.$executeRaw`DELETE FROM feeds WHERE url LIKE ${`https://example.test/${runId}/%`}`;
  }
});

function checkId(index: number): string {
  return `01MS13${index.toString().padStart(20, "0")}`;
}

function notModified(checkIdValue: string, feedId: bigint, checkedAt: Date): Record<string, unknown> {
  return {
    check_id: checkIdValue,
    feed_id: feedId.toString(),
    http_status: 304,
    outcome: "not_modified",
    checked_at: checkedAt.toISOString(),
    tier_attempted: 1,
    error_code: null,
    response_etag: '"nm-etag"',
    response_last_modified: null
  };
}

function noNew(checkIdValue: string, feedId: bigint, checkedAt: Date): Record<string, unknown> {
  return {
    check_id: checkIdValue,
    feed_id: feedId.toString(),
    http_status: 200,
    outcome: "no_new_entries",
    checked_at: checkedAt.toISOString(),
    tier_attempted: 1,
    error_code: null,
    response_etag: null,
    response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
    feed_title: "No New Title"
  };
}

function fetchError(checkIdValue: string, feedId: bigint, checkedAt: Date): Record<string, unknown> {
  return {
    check_id: checkIdValue,
    feed_id: feedId.toString(),
    http_status: 403,
    outcome: "fetch_error",
    checked_at: checkedAt.toISOString(),
    tier_attempted: 2,
    error_code: "HTTP_403"
  };
}
