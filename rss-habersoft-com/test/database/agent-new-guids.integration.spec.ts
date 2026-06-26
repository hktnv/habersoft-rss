import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { AgentNewGuidsModule } from "../../src/agent-new-guids/agent-new-guids.module";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { PostgresService } from "../../src/persistence/postgres.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type FeedIdentityRow = {
  readonly id: bigint;
  readonly url: string;
};
type FeedStateRow = {
  readonly url: string;
  readonly active: boolean | null;
  readonly subscriber_count: number;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly last_checked_at: Date | null;
  readonly last_new_entry_at: Date | null;
  readonly last_http_status: number | null;
  readonly error_count: number | null;
  readonly next_check_at: Date | null;
};
type EntryStateRow = {
  readonly feed_id: bigint;
  readonly guid: string;
  readonly url: string;
  readonly title: string;
  readonly first_seen_at: Date;
  readonly detail_extraction_status: string;
};
type ExplainRow = { readonly "QUERY PLAN": string };
type IndexRow = { readonly definition: string };
type QueryEvent = { readonly query: string };
type QueryLogOptions = {
  readonly datasourceUrl: string;
  readonly log: [{ readonly emit: "event"; readonly level: "query" }];
};
type QueryLogPrismaClient = PrismaClient<QueryLogOptions>;

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const runId = `ms011_${Date.now()}`;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for agent new GUIDs database integration tests.");
  }

  return databaseUrl;
}

function queryLogOptions(databaseUrl: string): QueryLogOptions {
  return {
    datasourceUrl: databaseUrl,
    log: [{ emit: "event", level: "query" }]
  };
}

describe("agent new GUID filtering with PostgreSQL", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: QueryLogPrismaClient;
  let queryEvents: QueryEvent[] = [];
  let targetFeedId: string;
  let otherFeedId: string;

  beforeAll(async () => {
    database = new PrismaClient(queryLogOptions(requireDatabaseUrl()));
    database.$on("query", (event) => {
      queryEvents.push({ query: event.query });
    });

    await cleanup();
    const seeded = await seedFeedsAndEntries();
    targetFeedId = seeded.targetFeedId;
    otherFeedId = seeded.otherFeedId;

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        AgentNewGuidsModule
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

  it("returns only absent target-feed GUIDs in request first-occurrence order", async () => {
    const response = await postNewGuids(targetFeedId, [
      guid("new-b"),
      guid("existing"),
      guid("new-a"),
      guid("new-b"),
      guid("cross-feed-only")
    ]);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      new: [guid("new-b"), guid("new-a"), guid("cross-feed-only")]
    });
  });

  it("does not treat an unknown feed as all-new", async () => {
    const response = await postNewGuids("9223372036854775807", [guid("new-for-unknown")]);

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
  });

  it("keeps retry reads advisory until the future write endpoint inserts entries", async () => {
    const first = await postNewGuids(targetFeedId, [guid("retry-a"), guid("retry-b")]);
    const second = await postNewGuids(targetFeedId, [guid("retry-a"), guid("retry-b")]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.payload)).toEqual({ new: [guid("retry-a"), guid("retry-b")] });
    expect(JSON.parse(second.payload)).toEqual(JSON.parse(first.payload));
  });

  it("returns the ordered subset after a downstream partial insert", async () => {
    await insertEntry(BigInt(targetFeedId), guid("partial-a"));

    const response = await postNewGuids(targetFeedId, [guid("partial-a"), guid("partial-b"), guid("partial-c")]);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ new: [guid("partial-b"), guid("partial-c")] });
  });

  it("allows concurrent advisory reads to observe the same absent GUIDs", async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => postNewGuids(targetFeedId, [guid("concurrent-a"), guid("concurrent-b")]))
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.map((response) => parseJson(response.payload))).toEqual(
      Array.from({ length: responses.length }, () => ({ new: [guid("concurrent-a"), guid("concurrent-b")] }))
    );
  });

  it("does not mutate feed, entry, detail, subscription, event, or runtime state", async () => {
    const before = await stateSnapshot();

    const response = await postNewGuids(targetFeedId, [guid("mutation-check-new"), guid("existing")]);

    const after = await stateSnapshot();
    expect(response.statusCode).toBe(200);
    expect(after).toEqual(before);
  });

  it("uses two bounded Prisma reads and the composite feed_id/guid index", async () => {
    queryEvents = [];
    const response = await postNewGuids(targetFeedId, [guid("plan-a"), guid("existing"), guid("plan-b")]);

    expect(response.statusCode).toBe(200);
    expect(queryEvents).toHaveLength(2);
    expect(queryEvents.map((event) => event.query).join("\n")).toContain("FROM \"public\".\"feeds\"");
    expect(queryEvents.map((event) => event.query).join("\n")).toContain("FROM \"public\".\"entries\"");

    const indexRows = await database.$queryRaw<IndexRow[]>`
      SELECT indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'entries_feed_id_guid_key'
    `;
    expect(indexRows[0]?.definition).toContain("feed_id, guid");

    await database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
      const explainRows = await transaction.$queryRaw<ExplainRow[]>`
        EXPLAIN
        SELECT guid
        FROM entries
        WHERE feed_id = ${BigInt(targetFeedId)}
          AND guid IN (${guid("existing")}, ${guid("plan-a")}, ${guid("plan-b")})
      `;
      expect(explainRows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("entries_feed_id_guid_key");
    });
  });

  async function postNewGuids(feedId: string, guids: readonly string[]): Promise<LightMyRequestResponse> {
    return fastify.inject({
      method: "POST",
      url: `/agent/feeds/${feedId}/new-guids`,
      headers: { "X-Agent-Key": agentKey },
      payload: { guids }
    });
  }

  async function stateSnapshot(): Promise<Readonly<Record<string, unknown>>> {
    const feeds = await database.$queryRaw<FeedStateRow[]>`
      SELECT
        url,
        active,
        subscriber_count,
        etag,
        last_modified,
        last_checked_at,
        last_new_entry_at,
        last_http_status,
        error_count,
        next_check_at
      FROM feeds
      WHERE url LIKE ${`https://ms011.example.test/${runId}/%`}
      ORDER BY url
    `;
    const entries = await database.$queryRaw<EntryStateRow[]>`
      SELECT feed_id, guid, url, title, first_seen_at, detail_extraction_status
      FROM entries
      WHERE guid LIKE ${`ms011:${runId}:%`}
      ORDER BY feed_id, guid
    `;
    const entryDetails = await database.$queryRaw<{ readonly count: bigint }[]>`
      SELECT count(*) AS count
      FROM entry_details
      WHERE feed_id IN (${BigInt(targetFeedId)}, ${BigInt(otherFeedId)})
    `;
    const siteFeeds = await database.$queryRaw<{ readonly site_client_id: string; readonly feed_id: bigint }[]>`
      SELECT site_client_id, feed_id
      FROM site_feeds
      WHERE feed_id IN (${BigInt(targetFeedId)}, ${BigInt(otherFeedId)})
      ORDER BY site_client_id, feed_id
    `;
    const events = await database.$queryRaw<{ readonly count: bigint }[]>`
      SELECT count(*) AS count
      FROM agent_feed_check_events
      WHERE feed_id IN (${BigInt(targetFeedId)}, ${BigInt(otherFeedId)})
    `;
    const runtime = await database.$queryRaw<{ readonly count: bigint }[]>`
      SELECT count(*) AS count
      FROM agent_runtime_status
      WHERE agent_id = ${`ms011:${runId}`}
    `;

    return {
      feeds: feeds.map((row) => ({
        ...row,
        last_checked_at: row.last_checked_at?.toISOString() ?? null,
        last_new_entry_at: row.last_new_entry_at?.toISOString() ?? null,
        next_check_at: row.next_check_at?.toISOString() ?? null
      })),
      entries: entries.map((row) => ({
        feed_id: row.feed_id.toString(10),
        guid: row.guid,
        url: row.url,
        title: row.title,
        first_seen_at: row.first_seen_at.toISOString(),
        detail_extraction_status: row.detail_extraction_status
      })),
      entry_details_count: entryDetails[0]?.count.toString(10),
      site_feeds: siteFeeds.map((row) => ({
        site_client_id: row.site_client_id,
        feed_id: row.feed_id.toString(10)
      })),
      agent_feed_check_events_count: events[0]?.count.toString(10),
      agent_runtime_status_count: runtime[0]?.count.toString(10)
    };
  }

  async function seedFeedsAndEntries(): Promise<{ readonly targetFeedId: string; readonly otherFeedId: string }> {
    const target = await insertFeed("target", true, 0);
    const other = await insertFeed("other", false, 0);

    await insertEntry(target.id, guid("existing"));
    await insertEntry(other.id, guid("cross-feed-only"));

    await database.$executeRaw`
      INSERT INTO site_feeds (site_client_id, feed_id, created_at)
      VALUES (${`ms011:${runId}:site`}, ${target.id}, now())
    `;

    return {
      targetFeedId: target.id.toString(10),
      otherFeedId: other.id.toString(10)
    };
  }

  async function insertFeed(name: string, active: boolean, subscriberCount: number): Promise<FeedIdentityRow> {
    const rows = await database.$queryRaw<FeedIdentityRow[]>`
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
        ${feedUrl(name)},
        ${active},
        ${subscriberCount},
        ${`"etag-${name}"`},
        ${"Tue, 17 Jun 2026 01:00:00 GMT"},
        '2026-06-20T10:00:00Z'::timestamptz,
        '2026-06-20T10:05:00Z'::timestamptz,
        200,
        0,
        '2026-06-20T11:00:00Z'::timestamptz,
        now()
      )
      RETURNING id, url
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error("failed_to_seed_ms011_feed");
    }

    return row;
  }

  async function insertEntry(feedId: bigint, entryGuid: string): Promise<void> {
    await database.$executeRaw`
      INSERT INTO entries (
        feed_id,
        guid,
        url,
        title,
        summary,
        images,
        videos,
        tags,
        author,
        meta,
        published_at,
        first_seen_at,
        detail_extraction_status,
        detail_extraction_error_code,
        detail_extraction_attempted_at,
        detail_extraction_finalized_at,
        has_detail,
        created_at
      )
      VALUES (
        ${feedId},
        ${entryGuid},
        ${`https://ms011.example.test/${runId}/entry/${encodeURIComponent(entryGuid)}`},
        ${`Entry ${entryGuid}`},
        NULL,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        NULL,
        '{}'::jsonb,
        NULL,
        '2026-06-20T10:10:00Z'::timestamptz,
        'ok',
        NULL,
        '2026-06-20T10:10:01Z'::timestamptz,
        '2026-06-20T10:10:02Z'::timestamptz,
        false,
        now()
      )
      ON CONFLICT (feed_id, guid) DO NOTHING
    `;
  }

  async function cleanup(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM site_feeds
      WHERE site_client_id = ${`ms011:${runId}:site`}
    `;
    await database.$executeRaw`
      DELETE FROM entries
      WHERE guid LIKE ${`ms011:${runId}:%`}
    `;
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url LIKE ${`https://ms011.example.test/${runId}/%`}
    `;
  }
});

function guid(name: string): string {
  return `ms011:${runId}:${name}`;
}

function feedUrl(name: string): string {
  return `https://ms011.example.test/${runId}/${name}.xml`;
}

function parseJson(payload: string): unknown {
  return JSON.parse(payload) as unknown;
}
