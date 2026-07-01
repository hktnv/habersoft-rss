import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_FEED_RECHECK_PATH,
  feedRecheckClientContract,
  parseFeedRecheckResponse,
  requestFeedRecheck,
  type FetchLike
} from "../src/adminOperations/feedRecheckClient";

describe("feed recheck client", () => {
  it("uses the exact same-origin POST contract with CSRF and idempotency only", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(jsonResponse(validResponse("accepted"), 202));

    const result = await requestFeedRecheck({
      fetchImpl,
      actionRef,
      csrfToken,
      idempotencyKey
    });

    expect(result.kind).toBe("accepted");
    expect(fetchImpl).toHaveBeenCalledWith(
      ADMIN_FEED_RECHECK_PATH,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Admin-CSRF": csrfToken,
          "X-Admin-Idempotency-Key": idempotencyKey
        })
      })
    );
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1])).not.toMatch(/Authorization|X-Agent-Key|Tenant|Cookie/iu);
    expect(feedRecheckClientContract).toMatchObject({
      path: "/admin-api/operations/feed-recheck-requests",
      method: "POST",
      browserPersistence: false,
      synchronousExternalFetch: false,
      arbitraryWrites: false
    });
  });

  it("maps accepted, duplicate, rate-limited, unavailable, and forbidden responses safely", async () => {
    await expect(parseFeedRecheckResponse(jsonResponse(validResponse("accepted"), 202))).resolves.toMatchObject({ kind: "accepted" });
    await expect(parseFeedRecheckResponse(jsonResponse(validResponse("already_pending"), 200))).resolves.toMatchObject({ kind: "already_pending" });
    await expect(parseFeedRecheckResponse(jsonResponse(validResponse("rate_limited"), 429))).resolves.toMatchObject({ kind: "rate_limited" });
    await expect(parseFeedRecheckResponse(jsonResponse(validResponse("unavailable"), 503))).resolves.toMatchObject({ kind: "unavailable" });
    await expect(parseFeedRecheckResponse(jsonResponse({ authenticated: true, reason: "csrf_failed" }, 403))).resolves.toMatchObject({ kind: "forbidden" });
  });

  it("rejects malformed, HTML, raw URL, and unsafe-message responses", async () => {
    await expect(parseFeedRecheckResponse(new Response("<html></html>", { status: 200 }))).resolves.toMatchObject({
      kind: "invalid_response"
    });
    await expect(
      parseFeedRecheckResponse(
        jsonResponse({
          ...validResponse("accepted"),
          target: { displayId: "feed_123456abcd", sourceHost: "news.example.org/rss.xml?secret=1" }
        }, 202)
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
    await expect(
      parseFeedRecheckResponse(jsonResponse({ ...validResponse("accepted"), message: "token=value" }, 202))
    ).resolves.toMatchObject({ kind: "invalid_response" });
  });
});

function validResponse(status: "accepted" | "already_pending" | "unavailable" | "not_found" | "rate_limited") {
  return {
    status,
    requestId: status === "accepted" || status === "already_pending" ? "recheck_abc123def456" : null,
    target: status === "not_found"
      ? null
      : {
          displayId: "feed_123456abcd",
          sourceHost: "news.example.org"
        },
    queued: status === "accepted",
    cooldownSeconds: status === "accepted" || status === "rate_limited" ? 300 : null,
    message: status === "accepted"
      ? "Feed recheck was requested through the existing due-feed path."
      : "Feed recheck request is safely bounded.",
    generatedAt: "2026-06-30T06:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const actionRef = `feed_recheck_v1.${"A".repeat(64)}`;
const csrfToken = "csrf_token_value_at_least_32_characters";
const idempotencyKey = "idem_1234567890abcdef";
