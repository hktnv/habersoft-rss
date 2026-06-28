import { describe, expect, it } from "vitest";
import { HEALTH_UPSTREAM_ENV_NAME, normalizeHealthUpstreamOrigin } from "../scripts/health-upstream-origin.mjs";

describe("server-only health upstream origin validation", () => {
  it("accepts absolute http and https origins and normalizes a trailing slash", () => {
    expect(normalizeHealthUpstreamOrigin("http://main-service-api:3000")).toBe("http://main-service-api:3000");
    expect(normalizeHealthUpstreamOrigin("https://example.invalid/")).toBe("https://example.invalid");
  });

  it("fails closed for missing or malformed upstream origins", () => {
    expect(() => normalizeHealthUpstreamOrigin("")).toThrow(HEALTH_UPSTREAM_ENV_NAME);
    expect(() => normalizeHealthUpstreamOrigin("ftp://example.invalid")).toThrow(/http/iu);
    expect(() => normalizeHealthUpstreamOrigin("http://user:pass@example.invalid")).toThrow(/userinfo/iu);
    expect(() => normalizeHealthUpstreamOrigin("http://example.invalid/api")).toThrow(/path/iu);
    expect(() => normalizeHealthUpstreamOrigin("http://example.invalid?target=/health/live")).toThrow(/query/iu);
    expect(() => normalizeHealthUpstreamOrigin("http://example.invalid#frag")).toThrow(/fragment/iu);
    expect(() => normalizeHealthUpstreamOrigin("http://example.invalid/$(whoami)")).toThrow();
  });
});
