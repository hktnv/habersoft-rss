import { toTenantEntryListResponse } from "../../src/tenant-entries/tenant-entries.mapper";

describe("toTenantEntryListResponse", () => {
  it("serializes BigInt IDs and nullable fields for the public DTO", () => {
    expect(
      toTenantEntryListResponse({
        id: 123n,
        guid: "guid-123",
        title: "Title",
        url: "https://example.test/entry",
        publishedAt: null,
        effectiveAt: new Date("2026-06-20T12:00:00.000Z"),
        summary: null,
        feedUrl: "https://example.test/feed.xml",
        hasDetail: false,
        primaryImage: null,
        tags: null,
        author: null
      })
    ).toEqual({
      id: "123",
      guid: "guid-123",
      title: "Title",
      url: "https://example.test/entry",
      published_at: null,
      effective_at: "2026-06-20T12:00:00.000Z",
      summary: null,
      feed_url: "https://example.test/feed.xml",
      has_detail: false,
      primary_image: null,
      tags: null,
      author: null
    });
  });
});
