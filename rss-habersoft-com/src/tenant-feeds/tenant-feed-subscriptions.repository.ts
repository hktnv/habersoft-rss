import { Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type {
  SubscribeFeedInput,
  SubscribeFeedResult,
  TenantFeedListItem,
  UnsubscribeFeedInput,
  UnsubscribeFeedResult
} from "./tenant-feeds.types";

type SubscribeFeedRow = {
  readonly id: bigint;
  readonly url: string;
  readonly active: boolean | null;
  readonly created_feed: boolean;
};

type InsertSubscriptionRow = {
  readonly feed_id: bigint;
};

type ListFeedRow = {
  readonly feed_id: bigint;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscribed_at: Date;
};

type UnsubscribeRow = {
  readonly feed_id: bigint;
};

const subscribeRetryLimit = 5;

@Injectable()
export class TenantFeedSubscriptionsRepository {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async subscribe(input: SubscribeFeedInput): Promise<SubscribeFeedResult> {
    for (let attempt = 1; attempt <= subscribeRetryLimit; attempt += 1) {
      const result = await this.trySubscribe(input);
      if (result !== "retry_feed_lookup") {
        return result;
      }

      await sleep(attempt);
    }

    throw new Error("tenant_feed_subscribe_retry_exhausted");
  }

  public async list(siteClientId: string): Promise<readonly TenantFeedListItem[]> {
    const rows = await this.database.$queryRaw<ListFeedRow[]>`
      SELECT
        sf.feed_id,
        f.url,
        f.title,
        f.active,
        sf.created_at AS subscribed_at
      FROM site_feeds sf
      INNER JOIN feeds f ON f.id = sf.feed_id
      WHERE sf.site_client_id = ${siteClientId}
      ORDER BY sf.created_at ASC, sf.feed_id ASC
    `;

    return rows.map((row) => ({
      feedId: row.feed_id,
      url: row.url,
      title: row.title,
      active: row.active,
      subscribedAt: row.subscribed_at
    }));
  }

  public async unsubscribe(input: UnsubscribeFeedInput): Promise<UnsubscribeFeedResult> {
    return this.database.$transaction(async (transaction) => {
      const deletedRows = await transaction.$queryRaw<UnsubscribeRow[]>`
        DELETE FROM site_feeds
        WHERE site_client_id = ${input.siteClientId}
          AND feed_id = ${input.feedId}
        RETURNING feed_id
      `;

      if (deletedRows.length === 0) {
        return { outcome: "already_absent" };
      }

      const updatedRows = await transaction.$queryRaw<UnsubscribeRow[]>`
        UPDATE feeds
        SET subscriber_count = subscriber_count - 1
        WHERE id = ${input.feedId}
          AND subscriber_count > 0
        RETURNING id AS feed_id
      `;

      if (updatedRows.length === 0) {
        throw new Error("tenant_feed_unsubscribe_subscriber_count_invariant_failed");
      }

      return { outcome: "unsubscribed" };
    });
  }

  private async trySubscribe(input: SubscribeFeedInput): Promise<SubscribeFeedResult | "retry_feed_lookup"> {
    return this.database.$transaction(async (transaction) => {
      const feedRows = await this.insertOrReadFeed(transaction, input.url);
      const feed = feedRows[0];

      if (feed === undefined) {
        return "retry_feed_lookup";
      }

      if (feed.active !== true) {
        return {
          outcome: "feed_admin_disabled",
          feedId: feed.id,
          url: feed.url
        };
      }

      const subscriptionRows = await transaction.$queryRaw<InsertSubscriptionRow[]>`
        INSERT INTO site_feeds (site_client_id, feed_id)
        VALUES (${input.siteClientId}, ${feed.id})
        ON CONFLICT DO NOTHING
        RETURNING feed_id
      `;

      if (subscriptionRows.length === 0) {
        return {
          outcome: "already_subscribed",
          feedId: feed.id,
          url: feed.url
        };
      }

      await transaction.$executeRaw`
        UPDATE feeds
        SET
          subscriber_count = subscriber_count + 1,
          next_check_at = CASE WHEN subscriber_count = 0 THEN now() ELSE next_check_at END,
          error_count = CASE WHEN subscriber_count = 0 THEN 0 ELSE error_count END,
          etag = CASE WHEN subscriber_count = 0 THEN NULL ELSE etag END,
          last_modified = CASE WHEN subscriber_count = 0 THEN NULL ELSE last_modified END
        WHERE id = ${feed.id}
      `;

      return {
        outcome: feed.created_feed ? "created_feed" : "subscribed_existing_feed",
        feedId: feed.id,
        url: feed.url
      };
    });
  }

  private async insertOrReadFeed(
    transaction: Prisma.TransactionClient,
    url: string
  ): Promise<readonly SubscribeFeedRow[]> {
    const insertedRows = await transaction.$queryRaw<SubscribeFeedRow[]>`
      INSERT INTO feeds (url, active, subscriber_count, next_check_at, created_at)
      VALUES (${url}, true, 0, now(), now())
      ON CONFLICT (url) DO NOTHING
      RETURNING id, url, active, true AS created_feed
    `;

    if (insertedRows.length > 0) {
      return insertedRows;
    }

    return transaction.$queryRaw<SubscribeFeedRow[]>`
      SELECT id, url, active, false AS created_feed
      FROM feeds
      WHERE url = ${url}
      LIMIT 1
    `;
  }
}

async function sleep(attempt: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, attempt * 5);
  });
}
