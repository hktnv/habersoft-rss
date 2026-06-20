import { mapDueFeedRecord } from "../../src/agent-due-feeds/agent-due-feeds.mapper";

describe("mapDueFeedRecord", () => {
  it("projects BigInt ids and nullable validators into the exact public DTO", () => {
    expect(
      mapDueFeedRecord({
        id: 9007199254740993n,
        url: "https://example.test/feed.xml",
        etag: "\"abc123\"",
        lastModified: null
      })
    ).toEqual({
      feed_id: "9007199254740993",
      url: "https://example.test/feed.xml",
      etag: "\"abc123\"",
      last_modified: null
    });
  });
});
