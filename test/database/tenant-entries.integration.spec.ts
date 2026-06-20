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

type ExplainRow = {
  readonly "QUERY PLAN": string;
};

type EntryListItem = {
  readonly id: string;
  readonly guid: string;
  readonly title: string;
  readonly url: string;
  readonly published_at: string | null;
  readonly effective_at: string;
  readonly summary: string | null;
  readonly feed_url: string;
  readonly has_detail: boolean;
  readonly primary_image: string | null;
  readonly tags: readonly string[] | null;
  readonly author: string | null;
};

describeIntegration("tenant entry listing with PostgreSQL and Redis", () => {
  const key = generateTestKeyPair("tenant-entries-kid");
  const runId = `ms006_${Date.now()}`;
  const urlPrefix = `https://ms006.example.test/${runId}`;
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
            maxRequests: 40,
            windowSeconds: 60,
            redisPrefix
          }
        }),
        TenantAuthModule,
        TenantFeedsModule,
        TenantEntriesModule
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

  it("lists only currently subscribed feed entries in canonical order", async () => {
    const tenant = `${runId}-tenant-a`;
    const otherTenant = `${runId}-tenant-b`;
    const activeFeed = await createFeed(`${urlPrefix}/active.xml`, true);
    const inactiveFeed = await createFeed(`${urlPrefix}/inactive.xml`, false);
    const unsubscribedFeed = await createFeed(`${urlPrefix}/unsubscribed.xml`, true);
    const sharedFeed = await createFeed(`${urlPrefix}/shared.xml`, true);

    await subscribe(tenant, activeFeed);
    await subscribe(tenant, inactiveFeed);
    await subscribe(tenant, sharedFeed);
    await subscribe(otherTenant, sharedFeed);
    await subscribe(otherTenant, unsubscribedFeed);

    await createEntry({
      feedId: activeFeed,
      guid: "a-newer",
      publishedAt: "2026-06-20T12:00:00.000Z",
      firstSeenAt: "2026-06-20T12:00:00.000Z",
      hasDetail: true,
      images: ["https://cdn.example.test/a-newer.jpg"],
      tags: ["politika", "gundem"],
      author: "Haber Merkezi"
    });
    await createEntry({
      feedId: inactiveFeed,
      guid: "inactive-visible",
      publishedAt: "2026-06-20T11:00:00.000Z",
      firstSeenAt: "2026-06-20T11:00:00.000Z",
      hasDetail: false,
      images: [],
      tags: null,
      author: null
    });
    await createEntry({
      feedId: unsubscribedFeed,
      guid: "unsubscribed-hidden",
      publishedAt: "2026-06-20T13:00:00.000Z",
      firstSeenAt: "2026-06-20T13:00:00.000Z",
      hasDetail: true,
      images: ["https://cdn.example.test/hidden.jpg"],
      tags: ["hidden"],
      author: "Other"
    });
    await createEntry({
      feedId: sharedFeed,
      guid: "shared-visible",
      publishedAt: null,
      firstSeenAt: "2026-06-20T10:00:00.000Z",
      hasDetail: false,
      images: ["https://cdn.example.test/shared.jpg"],
      tags: ["shared"],
      author: "Shared"
    });

    const response = await getEntries(tokenFor(tenant));
    const body = JSON.parse(response.payload) as readonly EntryListItem[];

    expect(response.statusCode).toBe(200);
    expect(body.map((entry) => entry.guid)).toEqual(["a-newer", "inactive-visible", "shared-visible"]);
    expect(response.payload).not.toContain("unsubscribed-hidden");
    expect(body[0]).toMatchObject({
      id: expect.any(String) as string,
      guid: "a-newer",
      title: "Title a-newer",
      url: "https://example.test/a-newer",
      published_at: "2026-06-20T12:00:00.000Z",
      effective_at: "2026-06-20T12:00:00.000Z",
      summary: "Summary a-newer",
      feed_url: `${urlPrefix}/active.xml`,
      has_detail: true,
      primary_image: "https://cdn.example.test/a-newer.jpg",
      tags: ["politika", "gundem"],
      author: "Haber Merkezi"
    });
    expect(body[1]?.feed_url).toBe(`${urlPrefix}/inactive.xml`);
    expect(body[1]?.primary_image).toBeNull();
    expect(body[1]?.tags).toBeNull();
    expect(body[2]?.published_at).toBeNull();
    expect(body[2]?.effective_at).toBe("2026-06-20T10:00:00.000Z");
  });

  it("applies offset pagination with effective_at and id tie-break ordering", async () => {
    const tenant = `${runId}-pagination`;
    const feed = await createFeed(`${urlPrefix}/pagination.xml`, true);
    await subscribe(tenant, feed);

    await createEntry({ feedId: feed, guid: "older", publishedAt: "2026-06-20T09:00:00.000Z" });
    await createEntry({ feedId: feed, guid: "tie-low", publishedAt: "2026-06-20T10:00:00.000Z" });
    await createEntry({ feedId: feed, guid: "tie-high", publishedAt: "2026-06-20T10:00:00.000Z" });
    await createEntry({ feedId: feed, guid: "newest", publishedAt: "2026-06-20T11:00:00.000Z" });

    const firstPage = await getEntries(tokenFor(tenant), "?offset=0&limit=2");
    const secondPage = await getEntries(tokenFor(tenant), "?offset=2&limit=2");
    const firstBody = JSON.parse(firstPage.payload) as readonly EntryListItem[];
    const secondBody = JSON.parse(secondPage.payload) as readonly EntryListItem[];

    expect(firstPage.statusCode).toBe(200);
    expect(secondPage.statusCode).toBe(200);
    expect(firstBody.map((entry) => entry.guid)).toEqual(["newest", "tie-high"]);
    expect(secondBody.map((entry) => entry.guid)).toEqual(["tie-low", "older"]);
  });

  it("rejects invalid query after consuming quota and before DB listing", async () => {
    const tenant = `${runId}-invalid-query`;
    const response = await getEntries(tokenFor(tenant), "?limit=101");

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
  });

  it("shares the tenant rate-limit bucket with feed routes", async () => {
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
        TenantEntriesModule
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
    const entries = await getEntries(token);
    const feeds = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { authorization: `Bearer ${token}` }
    });
    const limited = await getEntries(token);

    expect(entries.statusCode).toBe(200);
    expect(feeds.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  }, 60_000);

  it("does not create a detail route", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries/1/detail",
      headers: { authorization: `Bearer ${tokenFor(`${runId}-tenant-a`)}` }
    });

    expect(response.statusCode).toBe(404);
  });

  it("has an explainable bounded tenant entry query", async () => {
    const tenant = `${runId}-explain`;
    const feed = await createFeed(`${urlPrefix}/explain.xml`, true);
    await subscribe(tenant, feed);
    await createEntry({ feedId: feed, guid: "explain", publishedAt: "2026-06-20T14:00:00.000Z" });

    const plan = await explainTenantEntryQuery(tenant, 0, 50);

    expect(plan.join("\n")).toContain("entries");
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

  async function createEntry(input: {
    readonly feedId: bigint;
    readonly guid: string;
    readonly publishedAt?: string | null;
    readonly firstSeenAt?: string;
    readonly hasDetail?: boolean;
    readonly images?: readonly string[] | null;
    readonly tags?: readonly string[] | null;
    readonly author?: string | null;
  }): Promise<bigint> {
    const timestamp = input.publishedAt ?? input.firstSeenAt ?? "2026-06-20T00:00:00.000Z";
    const attemptedAt = "2026-06-20T00:00:01.000Z";
    const rows = await database.$queryRaw<IdRow[]>`
      INSERT INTO entries (
        feed_id,
        guid,
        url,
        title,
        summary,
        images,
        tags,
        author,
        published_at,
        first_seen_at,
        detail_extraction_status,
        detail_extraction_attempted_at,
        detail_extraction_finalized_at,
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
        CAST(${JSON.stringify(input.tags)} AS jsonb),
        ${input.author ?? null},
        ${input.publishedAt === null ? null : timestamp}::timestamptz,
        ${(input.firstSeenAt ?? timestamp)}::timestamptz,
        'ok',
        ${attemptedAt}::timestamptz,
        ${attemptedAt}::timestamptz,
        ${input.hasDetail ?? false},
        now()
      )
      RETURNING id
    `;

    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error("entry_insert_failed");
    }

    return id;
  }

  async function explainTenantEntryQuery(siteClientId: string, offset: number, limit: number): Promise<readonly string[]> {
    const perFeedWindow = offset + limit;
    const rows = await database.$queryRaw<ExplainRow[]>`
      EXPLAIN
      WITH followed_feeds AS (
        SELECT sf.feed_id
        FROM site_feeds sf
        WHERE sf.site_client_id = ${siteClientId}
      ),
      feed_entries AS (
        SELECT e.id, e.effective_at
        FROM followed_feeds ff
        CROSS JOIN LATERAL (
          SELECT e.id, e.effective_at
          FROM entries e
          WHERE e.feed_id = ff.feed_id
          ORDER BY e.effective_at DESC, e.id DESC
          LIMIT ${perFeedWindow}
        ) e
      )
      SELECT id, effective_at
      FROM feed_entries
      ORDER BY effective_at DESC, id DESC
      OFFSET ${offset}
      LIMIT ${limit}
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

  async function getEntries(token: string, query = "") {
    return fastify.inject({
      method: "GET",
      url: `/api/entries${query}`,
      headers: { authorization: `Bearer ${token}` }
    });
  }
});

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for tenant entries integration tests.");
  }

  return databaseUrl;
}

function requireRedisUrl(): string {
  if (redisUrl === undefined) {
    throw new Error("REDIS_URL is required for tenant entries integration tests.");
  }

  return redisUrl;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
