import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const MIGRATION_NAMES = [
  "20260620000000_initial_empty",
  "20260620001000_canonical_business_schema"
];

const EXPECTED_TABLES = [
  "agent_feed_check_events",
  "agent_runtime_status",
  "entries",
  "entry_details",
  "feeds",
  "site_feeds"
];

const EXPECTED_INDEXES = [
  "agent_feed_check_events_created",
  "entries_created",
  "entries_feed_effective",
  "entry_details_created",
  "entry_details_feed_effective",
  "feeds_due",
  "site_feeds_feed_id"
];

const EXPECTED_CHECK_CONSTRAINTS = [
  "agent_feed_check_events_entry_counts_by_outcome_check",
  "agent_feed_check_events_error_code_by_outcome_check",
  "agent_feed_check_events_feed_title_length_check",
  "agent_feed_check_events_feed_title_outcome_check",
  "agent_feed_check_events_http_status_by_outcome_check",
  "agent_feed_check_events_outcome_check",
  "agent_feed_check_events_response_etag_length_check",
  "agent_feed_check_events_response_last_modified_length_check",
  "agent_feed_check_events_tier_attempted_check",
  "entries_author_length_check",
  "entries_detail_extraction_attempted_at_check",
  "entries_detail_extraction_error_code_length_check",
  "entries_detail_extraction_error_code_ok_check",
  "entries_detail_extraction_status_check",
  "entries_detail_extraction_time_order_check",
  "entries_guid_length_check",
  "entries_summary_length_check",
  "entries_title_length_check",
  "entries_url_length_check",
  "entry_details_detail_length_check",
  "feeds_etag_length_check",
  "feeds_last_modified_length_check",
  "feeds_subscriber_count_non_negative",
  "feeds_title_length_check"
];

const EXPECTED_UNIQUE_CONSTRAINTS = [
  "entries_feed_id_guid_key",
  "entries_id_feed_id_unique",
  "feeds_url_key",
  "site_feeds_pkey"
];

const EXPECTED_FOREIGN_KEYS = [
  "entries_feed_id_fkey",
  "entry_details_entry_feed_match_fk",
  "site_feeds_feed_id_fkey"
];

type NamedRow = { name: string };
type CountRow = { count: bigint };
type ExplainRow = { "QUERY PLAN": string };
type IndexRow = { name: string; definition: string };
type MigrationRow = { migration_name: string };

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests.");
  }

  return databaseUrl;
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

function adminUrlFor(databaseUrl: string): string {
  return withDatabaseName(databaseUrl, "postgres");
}

function createTestDatabaseName(): string {
  const suffix = `${Date.now()}_${process.pid}`.replaceAll("-", "_");
  return `main_service_ms002_${suffix}`;
}

function runPrismaCommand(args: readonly string[], databaseUrl: string): string {
  const result = spawnSync("npx", ["prisma", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `npx prisma ${args.join(" ")} failed with status ${result.status ?? "null"}.`,
        result.stdout,
        result.stderr
      ].join("\n")
    );
  }

  return `${result.stdout}\n${result.stderr}`;
}

function expectArrayContainingExactly(actual: readonly string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

async function expectSqlFailure(
  action: () => Promise<unknown>,
  expected: { constraint?: string; sqlState?: string }
): Promise<void> {
  let capturedError: unknown;
  try {
    await action();
  } catch (error: unknown) {
    capturedError = error;
  }

  expect(capturedError).toMatchObject({ code: "P2010" });

  if (expected.sqlState) {
    const errorWithMeta = capturedError as { meta?: { code?: unknown } };
    expect(errorWithMeta.meta?.code).toBe(expected.sqlState);
  }

  if (expected.constraint) {
    expect(String(capturedError)).toContain(expected.constraint);
  }
}

describe("canonical business PostgreSQL schema", () => {
  let adminClient: PrismaClient;
  let databaseClient: PrismaClient;
  let testDatabaseName: string;
  let testDatabaseUrl: string;

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    testDatabaseName = createTestDatabaseName();
    testDatabaseUrl = withDatabaseName(databaseUrl, testDatabaseName);

    adminClient = new PrismaClient({ datasourceUrl: adminUrlFor(databaseUrl) });
    await adminClient.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName}"`);

    const firstDeployOutput = runPrismaCommand(["migrate", "deploy"], testDatabaseUrl);
    expect(firstDeployOutput).toContain("Applying migration `20260620001000_canonical_business_schema`");

    const secondDeployOutput = runPrismaCommand(["migrate", "deploy"], testDatabaseUrl);
    expect(secondDeployOutput).toContain("No pending migrations to apply");

    const statusOutput = runPrismaCommand(["migrate", "status"], testDatabaseUrl);
    expect(statusOutput).toContain("Database schema is up to date");

    databaseClient = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  }, 120_000);

  afterAll(async () => {
    await databaseClient?.$disconnect();
    await adminClient?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    await adminClient?.$disconnect();
  }, 30_000);

  it("replays exactly the preserved empty migration and the canonical schema migration", async () => {
    const migrations = await databaseClient.$queryRaw<MigrationRow[]>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE rolled_back_at IS NULL
      ORDER BY migration_name
    `;

    expect(migrations.map((row) => row.migration_name)).toEqual(MIGRATION_NAMES);
  });

  it("creates only the six canonical business tables", async () => {
    const tables = await databaseClient.$queryRaw<NamedRow[]>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `;

    expect(tables.map((row) => row.name)).toEqual(EXPECTED_TABLES);
  });

  it("creates the canonical indexes, checks, unique constraints, and foreign keys", async () => {
    const indexes = await databaseClient.$queryRaw<NamedRow[]>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY(${EXPECTED_INDEXES})
      ORDER BY indexname
    `;
    expectArrayContainingExactly(indexes.map((row) => row.name), EXPECTED_INDEXES);

    const checks = await databaseClient.$queryRaw<NamedRow[]>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE contype = 'c'
        AND connamespace = 'public'::regnamespace
      ORDER BY conname
    `;
    expectArrayContainingExactly(checks.map((row) => row.name), EXPECTED_CHECK_CONSTRAINTS);

    const uniques = await databaseClient.$queryRaw<NamedRow[]>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE contype IN ('p', 'u')
        AND connamespace = 'public'::regnamespace
        AND conname = ANY(${EXPECTED_UNIQUE_CONSTRAINTS})
      ORDER BY conname
    `;
    expectArrayContainingExactly(uniques.map((row) => row.name), EXPECTED_UNIQUE_CONSTRAINTS);

    const foreignKeys = await databaseClient.$queryRaw<NamedRow[]>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
      ORDER BY conname
    `;
    expectArrayContainingExactly(foreignKeys.map((row) => row.name), EXPECTED_FOREIGN_KEYS);
  });

  it("uses database-owned effective_at and enforces entry detail invariants", async () => {
    const feedRows = await databaseClient.$queryRaw<{ id: bigint }[]>`
      INSERT INTO feeds (url, active, subscriber_count, next_check_at, created_at)
      VALUES ('https://example.test/feed.xml', true, 1, now(), now())
      RETURNING id
    `;
    const feedId = feedRows[0]?.id;
    expect(feedId).toBeDefined();

    const entryRows = await databaseClient.$queryRaw<{ id: bigint; effective_at: Date }[]>`
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
        created_at
      )
      VALUES (
        ${feedId},
        'guid-1',
        'https://example.test/item-1',
        'Entry 1',
        '2026-06-20T08:00:00Z'::timestamptz,
        '2026-06-20T09:00:00Z'::timestamptz,
        'ok',
        '2026-06-20T09:01:00Z'::timestamptz,
        '2026-06-20T09:02:00Z'::timestamptz,
        now()
      )
      RETURNING id, effective_at
    `;
    const entry = entryRows[0];
    expect(entry?.effective_at.toISOString()).toBe("2026-06-20T08:00:00.000Z");

    await databaseClient.$executeRaw`
      INSERT INTO entry_details (entry_id, feed_id, effective_at, detail, detail_length, created_at)
      VALUES (${entry?.id}, ${feedId}, ${entry?.effective_at}, 'canonical detail', 16, now())
    `;

    const detailCount = await databaseClient.$queryRaw<CountRow[]>`
      SELECT count(*) AS count FROM entry_details WHERE entry_id = ${entry?.id}
    `;
    expect(detailCount[0]?.count).toBe(1n);

    await databaseClient.$executeRaw`DELETE FROM entries WHERE id = ${entry?.id}`;

    const detailCountAfterDelete = await databaseClient.$queryRaw<CountRow[]>`
      SELECT count(*) AS count FROM entry_details WHERE entry_id = ${entry?.id}
    `;
    expect(detailCountAfterDelete[0]?.count).toBe(0n);

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO entries (
          feed_id,
          guid,
          url,
          title,
          first_seen_at,
          effective_at,
          detail_extraction_status,
          detail_extraction_attempted_at,
          detail_extraction_finalized_at
        )
        VALUES (
          ${feedId},
          'guid-generated-reject',
          'https://example.test/generated-reject',
          'Generated reject',
          now(),
          now(),
          'ok',
          now(),
          now()
        )
      `,
      { sqlState: "428C9" }
    );
  });

  it("enforces canonical failure constraints at the database boundary", async () => {
    const feedRows = await databaseClient.$queryRaw<{ id: bigint }[]>`
      INSERT INTO feeds (url, subscriber_count)
      VALUES ('https://example.test/constraint-feed.xml', 0)
      RETURNING id
    `;
    const feedId = feedRows[0]?.id;

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO feeds (url, subscriber_count)
        VALUES ('https://example.test/bad-subscriber.xml', -1)
      `,
      { constraint: "feeds_subscriber_count_non_negative", sqlState: "23514" }
    );

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO entries (
          feed_id,
          guid,
          url,
          title,
          first_seen_at,
          detail_extraction_status,
          detail_extraction_attempted_at,
          detail_extraction_finalized_at
        )
        VALUES (${feedId}, 'bad-status', 'https://example.test/bad-status', 'Bad', now(), 'not_real', now(), now())
      `,
      { constraint: "entries_detail_extraction_status_check", sqlState: "23514" }
    );

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO entries (
          feed_id,
          guid,
          url,
          title,
          first_seen_at,
          detail_extraction_status,
          detail_extraction_attempted_at,
          detail_extraction_finalized_at
        )
        VALUES (${feedId}, 'bad-attempt', 'https://example.test/bad-attempt', 'Bad', now(), 'skipped_budget_exceeded', now(), now())
      `,
      { constraint: "entries_detail_extraction_attempted_at_check", sqlState: "23514" }
    );

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO entry_details (entry_id, feed_id, effective_at, detail)
        VALUES (999999, ${feedId}, now(), 'wrong feed')
      `,
      { constraint: "entry_details_entry_feed_match_fk", sqlState: "23503" }
    );

    await expectSqlFailure(
      () => databaseClient.$executeRaw`
        INSERT INTO agent_feed_check_events (
          check_id,
          outcome,
          http_status,
          entries_submitted_count,
          entries_saved_count,
          tier_attempted
        )
        VALUES ('bad-event', 'not_modified', 200, 0, 0, 1)
      `,
      { constraint: "agent_feed_check_events_http_status_by_outcome_check", sqlState: "23514" }
    );
  });

  it("keeps query paths backed by the canonical indexes", async () => {
    const indexDefinitions = await databaseClient.$queryRaw<IndexRow[]>`
      SELECT indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY(${EXPECTED_INDEXES})
      ORDER BY indexname
    `;

    const byName = new Map(indexDefinitions.map((row) => [row.name, row.definition]));
    expect(byName.get("feeds_due")).toContain("WHERE ((active = true) AND (subscriber_count > 0))");
    expect(byName.get("entries_feed_effective")).toContain("feed_id, effective_at DESC, id DESC");
    expect(byName.get("entry_details_feed_effective")).toContain("feed_id, effective_at DESC, entry_id DESC");

    const explainRows = await databaseClient.$queryRaw<ExplainRow[]>`
      EXPLAIN
      SELECT id
      FROM entries
      WHERE feed_id = 1
      ORDER BY effective_at DESC, id DESC
      LIMIT 10
    `;
    expect(explainRows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("entries");
  });
});
