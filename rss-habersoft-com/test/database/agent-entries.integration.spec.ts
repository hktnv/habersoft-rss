import { Prisma, PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { AgentEntriesModule } from "../../src/agent-entries/agent-entries.module";
import { nextPhaseSlotAfter } from "../../src/agent-entries/agent-entries.policy";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { PostgresService } from "../../src/persistence/postgres.service";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

type FeedIdentityRow = {
  readonly id: bigint;
  readonly created_at: Date;
};
type EntryRow = {
  readonly guid: string;
  readonly title: string;
  readonly first_seen_at: Date;
  readonly detail_extraction_status: string;
  readonly detail_extraction_error_code: string | null;
  readonly has_detail: boolean;
};
type DetailRow = {
  readonly detail: string;
  readonly detail_length: number | null;
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
  readonly outcome: string;
  readonly entries_submitted_count: number;
  readonly entries_saved_count: number;
  readonly error_code: string | null;
  readonly tier_attempted: number;
};

const agentKey = runtimeConfig.agentAuth?.key ?? "test_only_agent_key_at_least_32_bytes";
const runId = `ms012_${Date.now()}`;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for agent entries database integration tests.");
  }

  return databaseUrl;
}

describe("agent entry ingestion with PostgreSQL", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;
  let feed: FeedIdentityRow;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanup();
    feed = await insertFeed("target");

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        AgentEntriesModule
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

  it("writes event, new entries, ok details, and monotonic feed success state atomically", async () => {
    const checkedAt = new Date(Date.now() - 60_000);
    const response = await postEntries(payload({ checkId: checkId(1), checkedAt, entryNames: ["ok", "timeout"] }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      saved: 2,
      idempotent_replay: false
    });

    const entries = await entryRows(["ok", "timeout"]);
    expect(entries).toEqual([
      expect.objectContaining({ guid: guid("ok"), detail_extraction_status: "ok", has_detail: true }),
      expect.objectContaining({ guid: guid("timeout"), detail_extraction_status: "timeout", has_detail: false })
    ]);
    expect(entries.map((entry) => entry.first_seen_at.toISOString())).toEqual([
      checkedAt.toISOString(),
      checkedAt.toISOString()
    ]);

    const details = await detailRows("ok");
    expect(details).toEqual([{ detail: `Detail ${guid("ok")}`, detail_length: `Detail ${guid("ok")}`.length }]);
    await expect(detailRows("timeout")).resolves.toEqual([]);

    const event = await eventRow(checkId(1));
    expect(event).toEqual(
      expect.objectContaining({
        check_id: checkId(1),
        feed_id: feed.id,
        outcome: "entries_found",
        entries_submitted_count: 2,
        entries_saved_count: 2,
        error_code: null,
        tier_attempted: 1
      })
    );

    const state = await feedState();
    expect(state).toEqual(
      expect.objectContaining({
        title: `Feed ${runId}`,
        etag: `"etag-${runId}"`,
        last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
        last_http_status: 200,
        error_count: 0
      })
    );
    expect(state?.last_checked_at?.toISOString()).toBe(checkedAt.toISOString());
    expect(state?.last_new_entry_at?.toISOString()).toBe(checkedAt.toISOString());
    expect(state?.next_check_at?.toISOString()).toBe(nextPhaseSlotAfter(checkedAt, feed.id, feed.created_at).toISOString());
  });

  it("replays a processed check_id without additional writes", async () => {
    const checkedAt = new Date(Date.now() - 55_000);
    const first = await postEntries(payload({ checkId: checkId(2), checkedAt, entryNames: ["replay"] }));
    const second = await postEntries(payload({ checkId: checkId(2), checkedAt, entryNames: ["replay"] }));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload)).toEqual({ saved: 1, idempotent_replay: true });
    await expect(eventCount(checkId(2))).resolves.toBe(1);
    await expect(entryRows(["replay"])).resolves.toHaveLength(1);
  });

  it("skips duplicate entries by feed_id/guid while still recording the check event", async () => {
    const checkedAt = new Date(Date.now() - 50_000);
    const response = await postEntries(payload({ checkId: checkId(3), checkedAt, entryNames: ["replay"] }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ saved: 0, idempotent_replay: false });
    expect((await eventRow(checkId(3)))?.entries_saved_count).toBe(0);
  });

  it("does not let an older checked_at move feed state backwards", async () => {
    const newLastCheckedAt = new Date(Date.now() - 10_000);
    const oldCheckedAt = new Date(Date.now() - 120_000);
    await database.feed.update({
      where: { id: feed.id },
      data: {
        lastCheckedAt: newLastCheckedAt,
        nextCheckAt: new Date(Date.now() + 300_000),
        etag: '"newer"',
        lastModified: "newer",
        title: "Newer title"
      }
    });

    const before = await feedState();
    const response = await postEntries(payload({ checkId: checkId(4), checkedAt: oldCheckedAt, entryNames: ["old"] }));
    const after = await feedState();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ saved: 1, idempotent_replay: false });
    expect(after).toEqual(before);
  });

  it("rolls back the event ledger when the target feed does not exist", async () => {
    const response = await postEntries(
      payload({ checkId: checkId(5), checkedAt: new Date(Date.now() - 45_000), feedId: "9223372036854775807" })
    );

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    await expect(eventCount(checkId(5))).resolves.toBe(0);
  });

  async function postEntries(body: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return fastify.inject({
      method: "POST",
      url: "/agent/entries",
      headers: { "X-Agent-Key": agentKey },
      payload: body
    });
  }

  function payload(options: {
    readonly checkId: string;
    readonly checkedAt: Date;
    readonly entryNames?: readonly string[];
    readonly feedId?: string;
  }): Record<string, unknown> {
    const entryNames = options.entryNames ?? ["ok"];
    return {
      check_id: options.checkId,
      feed_id: options.feedId ?? feed.id.toString(10),
      checked_at: options.checkedAt.toISOString(),
      tier_attempted: 1,
      feed_title: `Feed ${runId}`,
      response_etag: `"etag-${runId}"`,
      response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
      entries: entryNames.map((name) => entryPayload(name, options.checkedAt))
    };
  }

  function entryPayload(name: string, checkedAt: Date): Record<string, unknown> {
    const ok = name !== "timeout";
    return {
      guid: guid(name),
      url: `https://ms012.example.test/${runId}/entries/${name}`,
      title: `Title ${name}`,
      summary: null,
      images: [],
      videos: [],
      tags: ["ms012"],
      author: null,
      meta: { run_id: runId },
      published_at: null,
      detail: ok ? `Detail ${guid(name)}` : null,
      detail_extraction: ok
        ? {
            status: "ok",
            attempted_at: new Date(checkedAt.getTime() + 1000).toISOString(),
            finalized_at: new Date(checkedAt.getTime() + 2000).toISOString(),
            error_code: null
          }
        : {
            status: "timeout",
            attempted_at: new Date(checkedAt.getTime() + 1000).toISOString(),
            finalized_at: new Date(checkedAt.getTime() + 2000).toISOString(),
            error_code: "TIMEOUT"
          }
    };
  }

  async function insertFeed(name: string): Promise<FeedIdentityRow> {
    const rows = await database.$queryRaw<FeedIdentityRow[]>`
      INSERT INTO feeds (
        url,
        title,
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
        ${`Old ${name}`},
        true,
        1,
        '"old"',
        'old',
        NULL,
        NULL,
        500,
        3,
        NULL,
        ${new Date(Date.now() - 3_600_000)}
      )
      RETURNING id, created_at
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new Error("failed_to_seed_ms012_feed");
    }

    return row;
  }

  async function entryRows(names: readonly string[]): Promise<readonly EntryRow[]> {
    return database.$queryRaw<EntryRow[]>`
      SELECT guid, title, first_seen_at, detail_extraction_status, detail_extraction_error_code, has_detail
      FROM entries
      WHERE feed_id = ${feed.id}
        AND guid IN (${Prisma.join(names.map(guid))})
      ORDER BY guid
    `;
  }

  async function detailRows(name: string): Promise<readonly DetailRow[]> {
    return database.$queryRaw<DetailRow[]>`
      SELECT detail, detail_length
      FROM entry_details
      WHERE feed_id = ${feed.id}
        AND entry_id = (
          SELECT id
          FROM entries
          WHERE feed_id = ${feed.id}
            AND guid = ${guid(name)}
        )
    `;
  }

  async function eventRow(id: string): Promise<EventRow | undefined> {
    const rows = await database.$queryRaw<EventRow[]>`
      SELECT check_id, feed_id, outcome, entries_submitted_count, entries_saved_count, error_code, tier_attempted
      FROM agent_feed_check_events
      WHERE check_id = ${id}
    `;
    return rows[0];
  }

  async function eventCount(id: string): Promise<number> {
    const rows = await database.$queryRaw<{ readonly count: bigint }[]>`
      SELECT count(*) AS count
      FROM agent_feed_check_events
      WHERE check_id = ${id}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  async function feedState(): Promise<FeedStateRow | undefined> {
    const rows = await database.$queryRaw<FeedStateRow[]>`
      SELECT title, etag, last_modified, last_checked_at, last_new_entry_at, last_http_status, error_count, next_check_at
      FROM feeds
      WHERE id = ${feed.id}
    `;
    return rows[0];
  }

  async function cleanup(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM agent_feed_check_events
      WHERE check_id LIKE ${"01K8Z3ABCD%"}
    `;
    await database.$executeRaw`
      DELETE FROM entries
      WHERE guid LIKE ${`ms012:${runId}:%`}
    `;
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url LIKE ${`https://ms012.example.test/${runId}/%`}
    `;
  }
});

function checkId(index: number): string {
  return `01K8Z3ABCD${index.toString(10).padStart(16, "0")}`;
}

function guid(name: string): string {
  return `ms012:${runId}:${name}`;
}

function feedUrl(name: string): string {
  return `https://ms012.example.test/${runId}/${name}.xml`;
}
