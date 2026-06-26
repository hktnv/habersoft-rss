import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type { TenantEntryListInput, TenantEntryListItem } from "./tenant-entries.types";

type TenantEntryRow = {
  readonly id: bigint;
  readonly guid: string;
  readonly title: string;
  readonly url: string;
  readonly published_at: Date | null;
  readonly effective_at: Date;
  readonly summary: string | null;
  readonly feed_url: string;
  readonly has_detail: boolean;
  readonly primary_image: unknown;
  readonly tags: unknown;
  readonly author: string | null;
};

@Injectable()
export class TenantEntryListRepository {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async list(input: TenantEntryListInput): Promise<readonly TenantEntryListItem[]> {
    const perFeedWindow = input.offset + input.limit;
    const rows = await this.database.$queryRaw<TenantEntryRow[]>`
      WITH followed_feeds AS (
        SELECT sf.feed_id
        FROM site_feeds sf
        WHERE sf.site_client_id = ${input.siteClientId}
      ),
      feed_entries AS (
        SELECT
          e.id,
          e.guid,
          e.title,
          e.url,
          e.published_at,
          e.effective_at,
          e.summary,
          f.url AS feed_url,
          e.has_detail,
          e.images ->> 0 AS primary_image,
          e.tags,
          e.author
        FROM followed_feeds ff
        INNER JOIN feeds f ON f.id = ff.feed_id
        CROSS JOIN LATERAL (
          SELECT
            e.id,
            e.guid,
            e.title,
            e.url,
            e.published_at,
            e.effective_at,
            e.summary,
            e.has_detail,
            e.images,
            e.tags,
            e.author
          FROM entries e
          WHERE e.feed_id = ff.feed_id
          ORDER BY e.effective_at DESC, e.id DESC
          LIMIT ${perFeedWindow}
        ) e
      )
      SELECT
        id,
        guid,
        title,
        url,
        published_at,
        effective_at,
        summary,
        feed_url,
        has_detail,
        primary_image,
        tags,
        author
      FROM feed_entries
      ORDER BY effective_at DESC, id DESC
      OFFSET ${input.offset}
      LIMIT ${input.limit}
    `;

    return rows.map(toListItem);
  }
}

function toListItem(row: TenantEntryRow): TenantEntryListItem {
  return {
    id: row.id,
    guid: row.guid,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    effectiveAt: row.effective_at,
    summary: row.summary,
    feedUrl: row.feed_url,
    hasDetail: row.has_detail,
    primaryImage: typeof row.primary_image === "string" ? row.primary_image : null,
    tags: toStringArrayOrNull(row.tags),
    author: row.author
  };
}

function toStringArrayOrNull(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (!value.every((item) => typeof item === "string")) {
    return null;
  }

  return value;
}
