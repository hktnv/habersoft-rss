import { PrismaClient } from "@prisma/client";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { JwksHttpClient } from "../../src/tenant-auth/jwks-http.client";
import { TenantAuthModule } from "../../src/tenant-auth/tenant-auth.module";
import { TenantFeedsModule } from "../../src/tenant-feeds/tenant-feeds.module";
import { generateTestKeyPair, jwks, runtimeConfig, signTenantToken } from "../tenant-auth/tenant-auth-test-helpers";

type FeedCounterRow = {
  readonly id: bigint;
  readonly subscriber_count: number;
};

type CountRow = {
  readonly count: bigint;
};

type ListFeedItem = {
  readonly feed_id: string;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscribed_at: string;
};

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for tenant feed database integration tests.");
  }

  return databaseUrl;
}

describe("tenant feed subscriptions with PostgreSQL", () => {
  const key = generateTestKeyPair("tenant-feeds-kid");
  const runId = `ms004_${Date.now()}`;
  const urlPrefix = `https://ms004.example.test/${runId}`;
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let database: PrismaClient;

  beforeAll(async () => {
    database = new PrismaClient({ datasourceUrl: requireDatabaseUrl() });
    await cleanup();

    const moduleRef = await Test.createTestingModule({
      imports: [
        RuntimeConfigModule.register({
          ...runtimeConfig,
          postgres: { url: requireDatabaseUrl() }
        }),
        TenantAuthModule,
        TenantFeedsModule
      ]
    })
      .overrideProvider(JwksHttpClient)
      .useValue({
        fetch: jest.fn().mockResolvedValue({ ok: true, body: jwks([key]) })
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

  it("subscribes, lists, and unsubscribes with a real signed tenant token", async () => {
    const token = tokenFor("ms004-http-site");
    const url = `${urlPrefix}/http-flow.xml`;

    const subscribe = await postFeed(token, url);
    const body = JSON.parse(subscribe.payload) as { readonly feed_id: string; readonly created_feed: boolean };
    const list = await getFeeds(token);
    const listBody = JSON.parse(list.payload) as readonly ListFeedItem[];
    const deleted = await deleteFeed(token, body.feed_id);
    const listAfterDelete = await getFeeds(token);

    expect(subscribe.statusCode).toBe(201);
    expect(body.created_feed).toBe(true);
    expect(list.statusCode).toBe(200);
    expect(listBody).toHaveLength(1);
    expect(listBody[0]).toEqual({
      feed_id: body.feed_id,
      url,
      title: null,
      active: true,
      subscribed_at: expect.any(String) as string
    });
    expect(listBody[0]?.subscribed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deleted.statusCode).toBe(204);
    expect(listAfterDelete.statusCode).toBe(200);
    expect(JSON.parse(listAfterDelete.payload)).toEqual([]);
  });

  it("keeps same-tenant concurrent subscription idempotent", async () => {
    const token = tokenFor("ms004-same-tenant");
    const url = `${urlPrefix}/same-tenant.xml`;
    const responses = await Promise.all(Array.from({ length: 8 }, () => postFeed(token, url)));

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    await expectFeedState(url, 1, 1);
  });

  it("increments once per distinct tenant under concurrent subscriptions", async () => {
    const url = `${urlPrefix}/many-tenants.xml`;
    const tenants = Array.from({ length: 8 }, (_, index) => `ms004-tenant-${index}`);
    const responses = await Promise.all(tenants.map((tenant) => postFeed(tokenFor(tenant), url)));

    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    await expectFeedState(url, 8, 8);
  });

  it("isolates tenant feed lists and ignores other-tenant unsubscribe attempts", async () => {
    const siteAToken = tokenFor("ms004-list-a");
    const siteBToken = tokenFor("ms004-list-b");
    const siteAUrl = `${urlPrefix}/site-a.xml`;
    const siteBUrl = `${urlPrefix}/site-b.xml`;
    const siteAFeedId = feedIdFrom(await postFeed(siteAToken, siteAUrl));
    const siteBFeedId = feedIdFrom(await postFeed(siteBToken, siteBUrl));

    const siteAList = await getFeeds(siteAToken);
    const siteBList = await getFeeds(siteBToken);
    const wrongTenantDelete = await deleteFeed(siteAToken, siteBFeedId);
    const siteBAfterWrongDelete = await getFeeds(siteBToken);

    expect(siteAList.payload).toContain(siteAFeedId);
    expect(siteAList.payload).not.toContain(siteBUrl);
    expect(siteBList.payload).toContain(siteBFeedId);
    expect(wrongTenantDelete.statusCode).toBe(204);
    expect(siteBAfterWrongDelete.payload).toContain(siteBUrl);
  });

  it("rejects inactive feeds without creating a tenant relation", async () => {
    const url = `${urlPrefix}/disabled.xml`;
    await database.$executeRaw`
      INSERT INTO feeds (url, active, subscriber_count, created_at)
      VALUES (${url}, false, 0, now())
    `;

    const response = await postFeed(tokenFor("ms004-disabled"), url);
    const relationCount = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM site_feeds sf
      INNER JOIN feeds f ON f.id = sf.feed_id
      WHERE f.url = ${url}
    `;

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "FEED_ADMIN_DISABLED" });
    expect(relationCount[0]?.count).toBe(0n);
  });

  async function cleanup(): Promise<void> {
    await database.$executeRaw`
      DELETE FROM site_feeds
      WHERE site_client_id LIKE ${`${runId}%`}
        OR site_client_id LIKE 'ms004-%'
    `;
    await database.$executeRaw`
      DELETE FROM feeds
      WHERE url LIKE ${`${urlPrefix}/%`}
    `;
  }

  function tokenFor(siteClientId: string): string {
    return signTenantToken({
      key,
      subject: siteClientId,
      clientId: siteClientId
    });
  }

  async function postFeed(token: string, url: string) {
    return fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: `Bearer ${token}` },
      payload: { url }
    });
  }

  async function getFeeds(token: string) {
    return fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { authorization: `Bearer ${token}` }
    });
  }

  async function deleteFeed(token: string, feedId: string) {
    return fastify.inject({
      method: "DELETE",
      url: `/api/feeds/${feedId}`,
      headers: { authorization: `Bearer ${token}` }
    });
  }

  function feedIdFrom(response: Awaited<ReturnType<typeof postFeed>>): string {
    const body = JSON.parse(response.payload) as { readonly feed_id: string };
    return body.feed_id;
  }

  async function expectFeedState(url: string, subscriberCount: number, relationCount: number): Promise<void> {
    const feedRows = await database.$queryRaw<FeedCounterRow[]>`
      SELECT id, subscriber_count
      FROM feeds
      WHERE url = ${url}
    `;
    const feed = feedRows[0];
    expect(feed?.subscriber_count).toBe(subscriberCount);

    const relationRows = await database.$queryRaw<CountRow[]>`
      SELECT count(*) AS count
      FROM site_feeds
      WHERE feed_id = ${feed?.id}
    `;
    expect(relationRows[0]?.count).toBe(BigInt(relationCount));
  }
});
