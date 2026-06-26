import {
  validateFeedId,
  validateNoQueryParameters,
  validateSubscribeFeedRequest
} from "../../src/tenant-feeds/tenant-feeds.request-validation";

describe("tenant feed request validation", () => {
  it("accepts absolute http and https URLs without changing their identity", () => {
    expect(validateSubscribeFeedRequest({ url: "https://example.test/rss.xml?b=2&a=1" })).toEqual({
      ok: true,
      value: { url: "https://example.test/rss.xml?b=2&a=1" }
    });
    expect(validateSubscribeFeedRequest({ url: "http://example.test/rss.xml" })).toEqual({
      ok: true,
      value: { url: "http://example.test/rss.xml" }
    });
  });

  it("rejects unknown fields and tenant override fields", () => {
    expect(validateSubscribeFeedRequest({ url: "https://example.test/rss.xml", extra: true }).ok).toBe(false);
    expect(validateSubscribeFeedRequest({ url: "https://example.test/rss.xml", site_client_id: "site-b" }).ok).toBe(
      false
    );
    expect(validateSubscribeFeedRequest({ url: "https://example.test/rss.xml", siteClientId: "site-b" }).ok).toBe(
      false
    );
    expect(validateSubscribeFeedRequest({ url: "https://example.test/rss.xml", tenant_id: "site-b" }).ok).toBe(
      false
    );
  });

  it("rejects non-object bodies, missing URLs, trimmed variants, relative URLs, and unsupported protocols", () => {
    expect(validateSubscribeFeedRequest(null).ok).toBe(false);
    expect(validateSubscribeFeedRequest([]).ok).toBe(false);
    expect(validateSubscribeFeedRequest({}).ok).toBe(false);
    expect(validateSubscribeFeedRequest({ url: " https://example.test/rss.xml" }).ok).toBe(false);
    expect(validateSubscribeFeedRequest({ url: "" }).ok).toBe(false);
    expect(validateSubscribeFeedRequest({ url: "/rss.xml" }).ok).toBe(false);
    expect(validateSubscribeFeedRequest({ url: "ftp://example.test/rss.xml" }).ok).toBe(false);
  });

  it("accepts empty query objects and rejects every query parameter", () => {
    expect(validateNoQueryParameters({}).ok).toBe(true);
    expect(validateNoQueryParameters({ site_client_id: "site-b" }).ok).toBe(false);
    expect(validateNoQueryParameters({ page: "1" }).ok).toBe(false);
    expect(validateNoQueryParameters(null).ok).toBe(false);
  });

  it("validates feed_id as a strict positive PostgreSQL bigint decimal string", () => {
    expect(validateFeedId("1")).toEqual({ ok: true, value: 1n });
    expect(validateFeedId("9223372036854775807")).toEqual({ ok: true, value: 9223372036854775807n });

    for (const value of ["0", "01", "+1", "-1", "1.0", "1e3", " 1", "9223372036854775808"]) {
      expect(validateFeedId(value).ok).toBe(false);
    }
  });
});
