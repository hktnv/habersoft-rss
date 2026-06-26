import type { DueFeedRecord, DueFeedResponseItem } from "./agent-due-feeds.types";

export function mapDueFeedRecord(record: DueFeedRecord): DueFeedResponseItem {
  return {
    feed_id: record.id.toString(10),
    url: record.url,
    etag: record.etag,
    last_modified: record.lastModified
  };
}
