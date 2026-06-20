import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AgentDueFeedsModule } from "../../src/agent-due-feeds/agent-due-feeds.module";
import { AGENT_DUE_FEEDS_CLOCK } from "../../src/agent-due-feeds/agent-due-feeds.clock";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
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
  readonly last_http_status: number | null;
  readonly error_count: number | null;
  readonly next_check_at: Date | null;
};
type ExplainRow = { readonly "QUERY PLAN": string };
type IndexRow = { readonly definition: string };

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const runId = `ms010_${Date.now()}`;
let currentServerNow = new Date("2026-06-20T12:00:00.000Z");

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for agent due feeds database integration tests.");
  }

  return databaseUrl;
}

describe("agent due feeds with PostgreSQL", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;
  let dueOrderedFeedIds: readonly string[] = [];

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanup();
    dueOrderedFeedIds = await seedFeeds();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        AgentDueFeedsModule
      ]
    })
      .overrideProvider(AGENT_DUE_FEEDS_CLOCK)
      .useValue({
        now: jest.fn(() => currentServerNow)
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

  it("returns only active subscribed feeds due at the captured server time in canonical order", async () => {
    currentServerNow = new Date("2026-06-20T12:00:00.000Z");

    const response = await getDue(3);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      feeds: [
        {
          feed_id: dueOrderedFeedIds[0],
          url: feedUrl("due-past-a"),
          etag: "\"past-a\"",
          last_modified: "Tue, 17 Jun 2026 01:00:00 GMT"
        },
        {
          feed_id: dueOrderedFeedIds[1],
          url: feedUrl("due-past-b"),
          etag: null,
          last_modified: null
        },
        {
          feed_id: dueOrderedFeedIds[2],
          url: feedUrl("due-same-a"),
          etag: "\"same-a\"",
          last_modified: null
        }
      ],
      feed_poll_interval_seconds: 900,
      has_more_due: true
    });
  });

  it("returns an empty canonical object when no feed is due at the captured time", async () => {
    currentServerNow = new Date("2026-06-20T11:00:00.000Z");

    const response = await getDue(1);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      feeds: [],
      feed_poll_interval_seconds: 900,
      has_more_due: false
    });
  });

  it("sets has_more_due false for exactly limit rows and never returns more than the requested limit", async () => {
    currentServerNow = new Date("2026-06-20T12:00:00.000Z");

    const response = await getDue(4);
    const body = JSON.parse(response.payload) as { feeds: readonly unknown[]; has_more_due: boolean };

    expect(response.statusCode).toBe(200);
    expect(body.feeds).toHaveLength(4);
    expect(body.has_more_due).toBe(false);
  });

  it("does not mutate feed scheduler state and repeated reads can return the same feed", async () => {
    currentServerNow = new Date("2026-06-20T12:00:00.000Z");
    const before = await feedStateSnapshot();

    const first = await getDue(1);
    const second = await getDue(1);
    const after = await feedStateSnapshot();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.payload)).toEqual(JSON.parse(second.payload));
    expect(after).toEqual(before);
  });

  it("keeps concurrent due reads safe and mutation-free without claim or lease state", async () => {
    currentServerNow = new Date("2026-06-20T12:00:00.000Z");
    const before = await feedStateSnapshot();

    const responses = await Promise.all(Array.from({ length: 4 }, () => getDue(2)));
    const after = await feedStateSnapshot();

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const payloads = responses.map((response) => JSON.parse(response.payload) as unknown);
    const firstPayload = JSON.parse(responses[0]?.payload ?? "{}") as unknown;
    expect(payloads).toEqual(Array.from({ length: responses.length }, () => firstPayload));
    expect(after).toEqual(before);
  });

  it("excludes a feed after downstream scheduler state advances next_check_at", async () => {
    currentServerNow = new Date("2026-06-20T12:00:00.000Z");
    await database.$executeRaw`
      UPDATE feeds
      SET next_check_at = '2026-06-20T12:30:00Z'::timestamptz
      WHERE url = ${feedUrl("due-past-a")}
    `;

    const response = await getDue(1);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      feeds: [
        {
          feed_id: dueOrderedFeedIds[1],
          url: feedUrl("due-past-b")
        }
      ],
      has_more_due: true
    });
  });

  it("keeps the due query backed by the canonical feeds_due index", async () => {
    const indexRows = await database.$queryRaw<IndexRow[]>`
      SELECT indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'feeds_due'
    `;
    expect(indexRows[0]?.definition).toContain("next_check_at, id");
    expect(indexRows[0]?.definition).toContain("WHERE ((active = true) AND (subscriber_count > 0))");

    await database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
      const explainRows = await transaction.$queryRaw<ExplainRow[]>`
        EXPLAIN
        SELECT id, url, etag, last_modified
        FROM feeds
        WHERE active = true
          AND subscriber_count > 0
          AND next_check_at <= '2026-06-20T12:00:00Z'::timestamptz
        ORDER BY next_check_at ASC, id ASC
        LIMIT 2
      `;
      expect(explainRows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("feeds_due");
    });
  });

  async function getDue(limit: number) {
    return fastify.inject({
      method: "GET",
      url: `/agent/feeds/due?limit=${limit}`,
      headers: { "X-Agent-Key": agentKey }
    });
  }

  async function feedStateSnapshot(): Promise<readonly Record<string, string | number | boolean | null>[]> {
    const rows = await database.$queryRaw<FeedStateRow[]>`
      SELECT
        url,
        active,
        subscriber_count,
        etag,
        last_modified,
        last_checked_at,
        last_http_status,
        error_count,
        next_check_at
      FROM feeds
      WHERE url LIKE ${`https://ms010.example.test/${runId}/%`}
      ORDER BY url
    `;

    return rows.map((row) => ({
      url: row.url,
      active: row.active,
      subscriber_count: row.subscriber_count,
      etag: row.etag,
      last_modified: row.last_modified,
      last_checked_at: row.last_checked_at?.toISOString() ?? null,
      last_http_status: row.last_http_status,
      error_count: row.error_count,
      next_check_at: row.next_check_at?.toISOString() ?? null
    }));
  }

  async function seedFeeds(): Promise<readonly string[]> {
    const duePastA = await insertFeed("due-past-a", true, 1, "2026-06-20T11:55:00Z", "\"past-a\"", "Tue, 17 Jun 2026 01:00:00 GMT");
    const duePastB = await insertFeed("due-past-b", true, 2, "2026-06-20T11:56:00Z", null, null);
    const dueSameA = await insertFeed("due-same-a", true, 1, "2026-06-20T12:00:00Z", "\"same-a\"", null);
    const dueSameB = await insertFeed("due-same-b", true, 1, "2026-06-20T12:00:00Z", null, "Tue, 17 Jun 2026 02:00:00 GMT");

    await insertFeed("future", true, 1, "2026-06-20T12:00:01Z", null, null);
    await insertFeed("inactive", false, 1, "2026-06-20T11:00:00Z", null, null);
    await insertFeed("zero-subscriber", true, 0, "2026-06-20T11:00:00Z", null, null);
    await insertFeed("null-next-check", true, 1, null, null, null);

    return [duePastA.id, duePastB.id, dueSameA.id, dueSameB.id].map((id) => id.toString(10));
  }

  async function insertFeed(
    name: string,
    active: boolean,
    subscriberCount: number,
    nextCheckAt: string | null,
    etag: string | null,
    lastModified: string | null
  ): Promise<FeedIdentityRow> {
    const rows = await database.$queryRaw<FeedIdentityRow[]>`
      INSERT INTO feeds (
        url,
        active,
        subscriber_count,
        etag,
        last_modified,
        last_checked_at,
        last_http_status,
        error_count,
        next_check_at,
        created_at
      )
      VALUES (
        ${feedUrl(name)},
        ${active},
        ${subscriberCount},
        ${etag},
        ${lastModified},
        '2026-06-20T10:00:00Z'::timestamptz,
        200,
        0,
        ${nextCheckAt}::timestamptz,
        now()
      )
      RETURNING id, url
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error("failed_to_seed_ms010_feed");
    }

    return row;
  }

  async function cleanup(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url LIKE ${`https://ms010.example.test/${runId}/%`}
    `;
  }
});

function feedUrl(name: string): string {
  return `https://ms010.example.test/${runId}/${name}.xml`;
}
