import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { RedisService } from "../../src/redis/redis.service";
import { JwksHttpClient } from "../../src/tenant-auth/jwks-http.client";
import { TenantAuthModule } from "../../src/tenant-auth/tenant-auth.module";
import { TenantEntryDetailModule } from "../../src/tenant-entry-detail/tenant-entry-detail.module";
import { TenantEntriesModule } from "../../src/tenant-entries/tenant-entries.module";
import { TenantFeedsModule } from "../../src/tenant-feeds/tenant-feeds.module";
import {
  generateTestKeyPair,
  jwks,
  runtimeConfig,
  signTenantToken,
  tenantRateLimitConfig
} from "../tenant-auth/tenant-auth-test-helpers";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeIntegration =
  databaseUrl === undefined || redisUrl === undefined || !existsSync("/.dockerenv") ? describe.skip : describe;

type IdRow = {
  readonly id: bigint;
};

type EntryRow = {
  readonly id: bigint;
  readonly effective_at: Date;
};

type ExplainRow = {
  readonly "QUERY PLAN": string;
};

type DetailBody = {
  readonly entry_id: string;
  readonly has_detail: boolean;
  readonly detail: string | null;
  readonly images: readonly string[];
  readonly videos: readonly string[];
  readonly tags: readonly string[];
  readonly author: string | null;
  readonly meta: Record<string, unknown>;
  readonly detail_extraction: {
    readonly status: string;
    readonly attempted_at: string | null;
    readonly finalized_at: string;
    readonly error_code: string | null;
  };
};

describeIntegration("tenant entry detail with PostgreSQL and Redis", () => {
  const key = generateTestKeyPair("tenant-entry-detail-kid");
  const runId = `ms007_${Date.now()}`;
  const urlPrefix = `https://ms007.example.test/${runId}`;
  const redisPrefix = `tenant_rate_limit:${runId}`;
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;
  let redis: RedisService;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanupDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() },
          redis: { url: requireRedisUrl() },
          tenantRateLimit: {
            ...tenantRateLimitConfig,
            maxRequests: 80,
            windowSeconds: 60,
            redisPrefix
          }
        }),
        TenantAuthModule,
        TenantFeedsModule,
        TenantEntriesModule,
        TenantEntryDetailModule
      ]
    })
      .overrideProvider(JwksHttpClient)
      .useValue({
        fetch: jest.fn().mockResolvedValue({ ok: true, body: jwks([key]) })
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    redis = app.get(RedisService);
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  }, 60_000);

  afterAll(async () => {
    await cleanupRedis();
    await app?.close();
    await cleanupDatabase();
    await database?.$disconnect();
  }, 30_000);

  it("returns visible active detail for a subscribed tenant", async () => {
    const tenant = `${runId}-success`;
    const feed = await createFeed(`${urlPrefix}/success.xml`, true);
    await subscribe(tenant, feed);
    const entry = await createEntry({
      feedId: feed,
      guid: "success",
      hasDetail: true,
      images: ["https://cdn.example.test/a.jpg"],
      videos: ["https://cdn.example.test/a.mp4"],
      tags: ["ekonomi"],
      author: "Haber Merkezi",
      meta: { "og:site_name": "Example" }
    });
    await createDetail(entry, feed, "<p>Exact detail</p>");

    const response = await getDetail(tokenFor(tenant), entry.id);
    const body = JSON.parse(response.payload) as DetailBody;

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      entry_id: entry.id.toString(),
      has_detail: true,
      detail: "<p>Exact detail</p>",
      images: ["https://cdn.example.test/a.jpg"],
      videos: ["https://cdn.example.test/a.mp4"],
      tags: ["ekonomi"],
      author: "Haber Merkezi",
      meta: { "og:site_name": "Example" },
      detail_extraction: {
        status: "ok",
        attempted_at: "2026-06-20T10:00:01.000Z",
        finalized_at: "2026-06-20T10:00:02.000Z",
        error_code: null
      }
    });
    expect(response.payload).not.toContain("detail_length");
  });

  it("returns detail null for visible entries without active detail", async () => {
    const tenant = `${runId}-null`;
    const feed = await createFeed(`${urlPrefix}/null.xml`, true);
    await subscribe(tenant, feed);
    const failed = await createEntry({
      feedId: feed,
      guid: "failed",
      status: "timeout",
      errorCode: "ARTICLE_TIMEOUT",
      hasDetail: false
    });
    const retainedOk = await createEntry({
      feedId: feed,
      guid: "retained-ok",
      status: "ok",
      hasDetail: false
    });

    const failedResponse = await getDetail(tokenFor(tenant), failed.id);
    const retainedResponse = await getDetail(tokenFor(tenant), retainedOk.id);

    expect(failedResponse.statusCode).toBe(200);
    expect(JSON.parse(failedResponse.payload)).toMatchObject({
      entry_id: failed.id.toString(),
      has_detail: false,
      detail: null,
      detail_extraction: {
        status: "timeout",
        error_code: "ARTICLE_TIMEOUT"
      }
    });
    expect(retainedResponse.statusCode).toBe(200);
    expect(JSON.parse(retainedResponse.payload)).toMatchObject({
      entry_id: retainedOk.id.toString(),
      has_detail: false,
      detail: null,
      detail_extraction: {
        status: "ok",
        error_code: null
      }
    });
  });

  it("uses one generic 404 for absent, unsubscribed, other-tenant, and unsubscribed-after-retention states", async () => {
    const tenant = `${runId}-not-found-a`;
    const otherTenant = `${runId}-not-found-b`;
    const feed = await createFeed(`${urlPrefix}/not-found.xml`, true);
    const otherFeed = await createFeed(`${urlPrefix}/other-feed.xml`, true);
    await subscribe(tenant, feed);
    await subscribe(otherTenant, otherFeed);
    const ownEntry = await createEntry({ feedId: feed, guid: "own", hasDetail: true });
    const otherEntry = await createEntry({ feedId: otherFeed, guid: "other", hasDetail: true });
    await createDetail(ownEntry, feed, "<p>Own</p>");
    await createDetail(otherEntry, otherFeed, "<p>Other</p>");

    const absent = await getDetail(tokenFor(tenant), 9223372036854775807n);
    const other = await getDetail(tokenFor(tenant), otherEntry.id);
    await unsubscribe(tenant, feed);
    const unsubscribed = await getDetail(tokenFor(tenant), ownEntry.id);

    expect(absent.statusCode).toBe(404);
    expect(other.statusCode).toBe(404);
    expect(unsubscribed.statusCode).toBe(404);
    expect(JSON.parse(absent.payload)).toEqual(JSON.parse(other.payload));
    expect(JSON.parse(other.payload)).toEqual(JSON.parse(unsubscribed.payload));
  });

  it("keeps inactive but subscribed feed entries visible", async () => {
    const tenant = `${runId}-inactive`;
    const feed = await createFeed(`${urlPrefix}/inactive.xml`, false);
    await subscribe(tenant, feed);
    const entry = await createEntry({ feedId: feed, guid: "inactive-visible", hasDetail: true });
    await createDetail(entry, feed, "<p>Inactive visible</p>");

    const response = await getDetail(tokenFor(tenant), entry.id);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      entry_id: entry.id.toString(),
      detail: "<p>Inactive visible</p>"
    });
  });

  it("does not mask corrupt has_detail/detail mismatches", async () => {
    const tenant = `${runId}-corrupt`;
    const feed = await createFeed(`${urlPrefix}/corrupt.xml`, true);
    await subscribe(tenant, feed);
    const missingDetail = await createEntry({ feedId: feed, guid: "missing-detail", hasDetail: true });
    const staleDetail = await createEntry({ feedId: feed, guid: "stale-detail", hasDetail: false });
    await createDetail(staleDetail, feed, "<p>Stale</p>");

    const missingResponse = await getDetail(tokenFor(tenant), missingDetail.id);
    const staleResponse = await getDetail(tokenFor(tenant), staleDetail.id);

    expect(missingResponse.statusCode).toBe(500);
    expect(staleResponse.statusCode).toBe(500);
  });

  it("produces only valid before and after states for cleanup and unsubscribe transitions", async () => {
    const tenant = `${runId}-transition`;
    const feed = await createFeed(`${urlPrefix}/transition.xml`, true);
    await subscribe(tenant, feed);
    const entry = await createEntry({ feedId: feed, guid: "transition", hasDetail: true });
    await createDetail(entry, feed, "<p>Before cleanup</p>");

    const beforeCleanup = await getDetail(tokenFor(tenant), entry.id);
    await removeDetailLikeCleanup(entry.id);
    const afterCleanup = await getDetail(tokenFor(tenant), entry.id);
    await unsubscribe(tenant, feed);
    const afterUnsubscribe = await getDetail(tokenFor(tenant), entry.id);

    expect(beforeCleanup.statusCode).toBe(200);
    expect(JSON.parse(beforeCleanup.payload)).toMatchObject({ has_detail: true, detail: "<p>Before cleanup</p>" });
    expect(afterCleanup.statusCode).toBe(200);
    expect(JSON.parse(afterCleanup.payload)).toMatchObject({ has_detail: false, detail: null });
    expect(afterUnsubscribe.statusCode).toBe(404);
  });

  it("shares the same tenant rate-limit bucket with feed and entry list routes", async () => {
    await cleanupRedis();
    await app?.close();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() },
          redis: { url: requireRedisUrl() },
          tenantRateLimit: {
            ...tenantRateLimitConfig,
            maxRequests: 2,
            windowSeconds: 60,
            redisPrefix: `${redisPrefix}:shared`
          }
        }),
        TenantAuthModule,
        TenantFeedsModule,
        TenantEntriesModule,
        TenantEntryDetailModule
      ]
    })
      .overrideProvider(JwksHttpClient)
      .useValue({
        fetch: jest.fn().mockResolvedValue({ ok: true, body: jwks([key]) })
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    redis = app.get(RedisService);
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();

    const token = tokenFor(`${runId}-shared-rate`);
    const feeds = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { authorization: `Bearer ${token}` }
    });
    const entries = await fastify.inject({
      method: "GET",
      url: "/api/entries",
      headers: { authorization: `Bearer ${token}` }
    });
    const limitedDetail = await getDetail(token, 1n);

    expect(feeds.statusCode).toBe(200);
    expect(entries.statusCode).toBe(200);
    expect(limitedDetail.statusCode).toBe(429);
  }, 60_000);

  it("has an explainable tenant-visible optional detail query", async () => {
    const tenant = `${runId}-explain`;
    const feed = await createFeed(`${urlPrefix}/explain.xml`, true);
    await subscribe(tenant, feed);
    const entry = await createEntry({ feedId: feed, guid: "explain", hasDetail: true });
    await createDetail(entry, feed, "<p>Explain</p>");

    const plan = await explainTenantEntryDetailQuery(tenant, entry.id);

    expect(plan.join("\n")).toContain("entries");
    expect(plan.join("\n")).toContain("site_feeds");
    expect(plan.join("\n")).toContain("entry_details");
  });

  async function createFeed(url: string, active: boolean): Promise<bigint> {
    const rows = await database.$queryRaw<IdRow[]>`
      INSERT INTO feeds (url, active, subscriber_count, next_check_at, created_at)
      VALUES (${url}, ${active}, 0, now(), now())
      RETURNING id
    `;

    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error("feed_insert_failed");
    }

    return id;
  }

  async function subscribe(siteClientId: string, feedId: bigint): Promise<void> {
    await database.$executeRaw`
      INSERT INTO site_feeds (site_client_id, feed_id)
      VALUES (${siteClientId}, ${feedId})
      ON CONFLICT DO NOTHING
    `;
  }

  async function unsubscribe(siteClientId: string, feedId: bigint): Promise<void> {
    await database.$executeRaw`
      DELETE FROM site_feeds
      WHERE site_client_id = ${siteClientId}
        AND feed_id = ${feedId}
    `;
  }

  async function createEntry(input: {
    readonly feedId: bigint;
    readonly guid: string;
    readonly hasDetail?: boolean;
    readonly status?: string;
    readonly errorCode?: string | null;
    readonly images?: readonly string[];
    readonly videos?: readonly string[];
    readonly tags?: readonly string[];
    readonly author?: string | null;
    readonly meta?: Record<string, unknown>;
  }): Promise<EntryRow> {
    const status = input.status ?? "ok";
    const attemptedAt = status === "skipped_budget_exceeded" ? null : "2026-06-20T10:00:01.000Z";
    const finalizedAt = "2026-06-20T10:00:02.000Z";
    const rows = await database.$queryRaw<EntryRow[]>`
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
        detail_extraction_attempted_at,
        detail_extraction_finalized_at,
        detail_extraction_error_code,
        has_detail,
        created_at
      )
      VALUES (
        ${input.feedId},
        ${input.guid},
        ${`https://example.test/${input.guid}`},
        ${`Title ${input.guid}`},
        ${`Summary ${input.guid}`},
        CAST(${JSON.stringify(input.images ?? [])} AS jsonb),
        CAST(${JSON.stringify(input.videos ?? [])} AS jsonb),
        CAST(${JSON.stringify(input.tags ?? [])} AS jsonb),
        ${input.author ?? null},
        CAST(${JSON.stringify(input.meta ?? {})} AS jsonb),
        '2026-06-20T10:00:00.000Z'::timestamptz,
        '2026-06-20T10:00:00.000Z'::timestamptz,
        ${status},
        ${attemptedAt}::timestamptz,
        ${finalizedAt}::timestamptz,
        ${input.errorCode ?? null},
        ${input.hasDetail ?? false},
        now()
      )
      RETURNING id, effective_at
    `;

    const row = rows[0];
    if (row === undefined) {
      throw new Error("entry_insert_failed");
    }

    return row;
  }

  async function createDetail(entry: EntryRow, feedId: bigint, detail: string): Promise<void> {
    await database.$executeRaw`
      INSERT INTO entry_details (entry_id, feed_id, effective_at, detail, detail_length, created_at)
      VALUES (${entry.id}, ${feedId}, ${entry.effective_at}, ${detail}, char_length(${detail}), now())
    `;
  }

  async function removeDetailLikeCleanup(entryId: bigint): Promise<void> {
    await database.$transaction([
      database.$executeRaw`UPDATE entries SET has_detail = false WHERE id = ${entryId}`,
      database.$executeRaw`DELETE FROM entry_details WHERE entry_id = ${entryId}`
    ]);
  }

  async function explainTenantEntryDetailQuery(siteClientId: string, entryId: bigint): Promise<readonly string[]> {
    const rows = await database.$queryRaw<ExplainRow[]>`
      EXPLAIN
      SELECT e.id, ed.detail
      FROM entries e
      INNER JOIN site_feeds sf
        ON sf.feed_id = e.feed_id
       AND sf.site_client_id = ${siteClientId}
      LEFT JOIN entry_details ed
        ON ed.entry_id = e.id
       AND ed.feed_id = e.feed_id
      WHERE e.id = ${entryId}
      LIMIT 2
    `;

    return rows.map((row) => row["QUERY PLAN"]);
  }

  async function cleanupDatabase(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM site_feeds
      WHERE site_client_id LIKE ${`${runId}-%`}
    `;
    await database.$executeRaw`
      DELETE FROM entries
      WHERE feed_id IN (
        SELECT id
        FROM feeds
        WHERE url LIKE ${`${urlPrefix}/%`}
      )
    `;
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url LIKE ${`${urlPrefix}/%`}
    `;
  }

  async function cleanupRedis(): Promise<void> {
    if (redis === undefined) {
      return;
    }

    const keys = await redis.command().call("KEYS", `${redisPrefix}*`);
    if (isStringArray(keys) && keys.length > 0) {
      await redis.command().call("DEL", ...keys);
    }
  }

  function tokenFor(siteClientId: string): string {
    return signTenantToken({
      key,
      subject: siteClientId,
      clientId: siteClientId
    });
  }

  async function getDetail(token: string, entryId: bigint) {
    return fastify.inject({
      method: "GET",
      url: `/api/entries/${entryId.toString()}/detail`,
      headers: { authorization: `Bearer ${token}` }
    });
  }
});

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for tenant entry detail integration tests.");
  }

  return databaseUrl;
}

function requireRedisUrl(): string {
  if (redisUrl === undefined) {
    throw new Error("REDIS_URL is required for tenant entry detail integration tests.");
  }

  return redisUrl;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
