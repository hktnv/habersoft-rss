import type { TenantEntryListItem } from "./tenant-entries.types";

export type TenantEntryListResponseItem = {
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

export function toTenantEntryListResponse(row: TenantEntryListItem): TenantEntryListResponseItem {
  return {
    id: row.id.toString(),
    guid: row.guid,
    title: row.title,
    url: row.url,
    published_at: row.publishedAt?.toISOString() ?? null,
    effective_at: row.effectiveAt.toISOString(),
    summary: row.summary,
    feed_url: row.feedUrl,
    has_detail: row.hasDetail,
    primary_image: row.primaryImage,
    tags: row.tags,
    author: row.author
  };
}
