import { PrismaClient } from "@prisma/client";
import { CleanupPostgresExecutor } from "../../src/maintenance/cleanup.postgres-executor";
import type { RuntimeConfig } from "../../src/configuration/runtime-config";

type IdRow = { readonly id: bigint };
type CountRow = { readonly count: bigint };
type EntryStateRow = { readonly id: bigint; readonly guid: string; readonly has_detail: boolean };

const runId = `ms014_${Date.now()}`;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for cleanup integration tests.");
  }

  return databaseUrl;
}

describe("cleanup retention with PostgreSQL", () => {
  let database: PrismaClient;
  let executor: CleanupPostgresExecutor;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    executor = new CleanupPostgresExecutor(
      { database: () => database } as never,
      {
        maintenance: {
          entryRetentionDays: 30,
          entryMaxPerFeed: 2,
          entryDetailRetentionDays: 7,
          entryDetailMaxPerFeed: 1,
          bullmqPrefix: "main-service-test",
          completedJobRetentionSeconds: 60,
          completedJobMaxCount: 10,
          failedJobRetentionSeconds: 60,
          failedJobMaxCount: 10
        }
      } as RuntimeConfig
    );
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await database.$disconnect();
  });

  it("runs entries age and cap cleanup without mutating unrelated tables", async () => {
    const feedId = await insertFeed("entries");
    await insertEntry(feedId, "old", "2026-01-01T00:00:00Z", true);
    await insertEntry(feedId, "new-1", "2026-06-20T00:00:00Z", true);
    await insertEntry(feedId, "new-2", "2026-06-21T00:00:00Z", false);
    await insertEntry(feedId, "new-3", "2026-06-22T00:00:00Z", false);

    expect(await executor.runEntriesAgeRetention()).toBeGreaterThanOrEqual(1);
    expect(await entryCount("old")).toBe(0);
    expect(await detailCountForGuid("old")).toBe(0);

    expect(await executor.runEntriesPerFeedCap()).toBeGreaterThanOrEqual(1);
    const remaining = await entriesForFeed(feedId);
    expect(remaining.map((entry) => entry.guid)).toEqual([`${runId}-new-3`, `${runId}-new-2`]);
  });

  it("runs detail age and cap cleanup atomically with parent has_detail=false", async () => {
    const feedId = await insertFeed("details");
    await insertEntry(feedId, "detail-old", "2026-06-20T00:00:00Z", true, "2026-01-01T00:00:00Z");
    await insertEntry(feedId, "detail-new-1", "2026-06-21T00:00:00Z", true);
    await insertEntry(feedId, "detail-new-2", "2026-06-22T00:00:00Z", true);

    expect(await executor.runEntryDetailsAgeRetention()).toBeGreaterThanOrEqual(1);
    expect(await detailCountForGuid("detail-old")).toBe(0);
    expect((await entryByGuid("detail-old"))?.has_detail).toBe(false);

    expect(await executor.runEntryDetailsPerFeedCap()).toBeGreaterThanOrEqual(1);
    expect(await detailCountForGuid("detail-new-1")).toBe(0);
    expect((await entryByGuid("detail-new-1"))?.has_detail).toBe(false);
    expect(await detailCountForGuid("detail-new-2")).toBe(1);
  });

  it("runs event retention and VACUUM ANALYZE through bounded static commands", async () => {
    await insertEvent("old-event", "2026-01-01T00:00:00Z");
    await insertEvent("new-event", new Date().toISOString());

    expect(await executor.runAgentFeedCheckEventsAgeRetention()).toBeGreaterThanOrEqual(1);
    expect(await eventCount("old-event")).toBe(0);
    expect(await eventCount("new-event")).toBe(1);
    expect(await executor.runVacuumAnalyze()).toBe(3);
  });

  async function insertFeed(label: string): Promise<bigint> {
    const rows = await database.$queryRaw<IdRow[]>`
      INSERT INTO feeds (url, active, subscriber_count, next_check_at, created_at)
      VALUES (${`https://example.test/${runId}/${label}.rss`}, true, 1, now(), now())
      RETURNING id
    `;
    return rows[0]!.id;
  }

  async function insertEntry(
    feedId: bigint,
    guid: string,
    effectiveAt: string,
    withDetail: boolean,
    detailCreatedAt = new Date().toISOString()
  ): Promise<bigint> {
    const rows = await database.$queryRaw<IdRow[]>`
      INSERT INTO entries (
        feed_id, guid, url, title, first_seen_at, detail_extraction_status,
        detail_extraction_attempted_at, detail_extraction_finalized_at, has_detail, created_at
      )
      VALUES (
        ${feedId},
        ${`${runId}-${guid}`},
        ${`https://example.test/${runId}/${guid}`},
        ${`Entry ${guid}`},
        ${effectiveAt}::timestamptz,
        'ok',
        ${effectiveAt}::timestamptz,
        ${effectiveAt}::timestamptz,
        ${withDetail},
        ${effectiveAt}::timestamptz
      )
      RETURNING id
    `;
    const entryId = rows[0]!.id;

    if (withDetail) {
      await database.$executeRaw`
        INSERT INTO entry_details (entry_id, feed_id, effective_at, detail, detail_length, created_at)
        VALUES (${entryId}, ${feedId}, ${effectiveAt}::timestamptz, ${`Detail ${guid}`}, 12, ${detailCreatedAt}::timestamptz)
      `;
    }

    return entryId;
  }

  async function insertEvent(checkId: string, createdAt: string): Promise<void> {
    await database.$executeRaw`
      INSERT INTO agent_feed_check_events (
        check_id, outcome, http_status, entries_submitted_count, entries_saved_count, tier_attempted, created_at
      )
      VALUES (${`${runId}-${checkId}`}, 'not_modified', 304, 0, 0, 1, ${createdAt}::timestamptz)
    `;
  }

  async function entriesForFeed(feedId: bigint): Promise<readonly EntryStateRow[]> {
    return database.$queryRaw<EntryStateRow[]>`
      SELECT id, guid, has_detail
      FROM entries
      WHERE feed_id = ${feedId}
      ORDER BY effective_at DESC, id DESC
    `;
  }

  async function entryByGuid(guid: string): Promise<EntryStateRow | null> {
    const rows = await database.$queryRaw<EntryStateRow[]>`
      SELECT id, guid, has_detail
      FROM entries
      WHERE guid = ${`${runId}-${guid}`}
    `;
    return rows[0] ?? null;
  }

  async function entryCount(guid: string): Promise<number> {
    const rows = await database.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count FROM entries WHERE guid = ${`${runId}-${guid}`}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function detailCountForGuid(guid: string): Promise<number> {
    const rows = await database.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM entry_details d
      JOIN entries e ON e.id = d.entry_id
      WHERE e.guid = ${`${runId}-${guid}`}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function eventCount(checkId: string): Promise<number> {
    const rows = await database.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS count
      FROM agent_feed_check_events
      WHERE check_id = ${`${runId}-${checkId}`}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function cleanup(): Promise<void> {
    if (database === undefined) {
      return;
    }

    await database.$executeRaw`DELETE FROM agent_feed_check_events WHERE check_id LIKE ${`${runId}-%`}`;
    await database.$executeRaw`
      DELETE FROM entry_details
      WHERE entry_id IN (
        SELECT e.id
        FROM entries e
        JOIN feeds f ON f.id = e.feed_id
        WHERE f.url LIKE ${`https://example.test/${runId}/%`}
      )
    `;
    await database.$executeRaw`
      DELETE FROM entries
      WHERE feed_id IN (
        SELECT id FROM feeds WHERE url LIKE ${`https://example.test/${runId}/%`}
      )
    `;
    await database.$executeRaw`DELETE FROM feeds WHERE url LIKE ${`https://example.test/${runId}/%`}`;
  }
});
