import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_FEED_ONBOARDING_PATH,
  feedOnboardingClientContract,
  parseFeedOnboardingResponse,
  requestFeedOnboarding,
  type FetchLike
} from "../src/adminOperations/feedOnboardingClient";

describe("feed onboarding client", () => {
  it("uses the exact same-origin POST contract with CSRF and idempotency only", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValueOnce(jsonResponse(validResponse("created"), 201));

    const result = await requestFeedOnboarding({
      fetchImpl,
      feedUrl: "https://news.example.org/feed.xml?private=1",
      label: "Example News",
      csrfToken,
      idempotencyKey
    });

    expect(result.kind).toBe("created");
    expect(fetchImpl).toHaveBeenCalledWith(
      ADMIN_FEED_ONBOARDING_PATH,
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
    expect(feedOnboardingClientContract).toMatchObject({
      path: "/admin-api/operations/feed-onboarding-requests",
      method: "POST",
      browserPersistence: false,
      synchronousExternalFetch: false,
      arbitraryWrites: false,
      rawUrlInEvidence: false
    });
  });

  it("rejects unsafe URLs before sending", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    for (const feedUrl of [
      "http://news.example.org/feed.xml",
      "https://user:pass@news.example.org/feed.xml",
      "https://news.example.org/feed.xml#frag",
      "https://localhost/feed.xml",
      "https://host.docker.internal/feed.xml",
      "https://main-service-api/feed.xml"
    ]) {
      await expect(
        requestFeedOnboarding({
          fetchImpl,
          feedUrl,
          csrfToken,
          idempotencyKey
        })
      ).resolves.toMatchObject({ kind: "invalid_request" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps created, duplicate, unavailable, rate-limited, and forbidden responses safely", async () => {
    await expect(parseFeedOnboardingResponse(jsonResponse(validResponse("created"), 201))).resolves.toMatchObject({ kind: "created" });
    await expect(parseFeedOnboardingResponse(jsonResponse(validResponse("already_exists"), 200))).resolves.toMatchObject({ kind: "already_exists" });
    await expect(parseFeedOnboardingResponse(jsonResponse(validResponse("unavailable"), 422))).resolves.toMatchObject({ kind: "unavailable" });
    await expect(parseFeedOnboardingResponse(jsonResponse(validResponse("rate_limited"), 429))).resolves.toMatchObject({ kind: "rate_limited" });
    await expect(parseFeedOnboardingResponse(jsonResponse({ authenticated: true, reason: "csrf_failed" }, 403))).resolves.toMatchObject({ kind: "forbidden" });
  });

  it("rejects malformed, HTML, raw URL, and unsafe-message responses", async () => {
    await expect(parseFeedOnboardingResponse(new Response("<html></html>", { status: 200 }))).resolves.toMatchObject({
      kind: "invalid_response"
    });
    await expect(
      parseFeedOnboardingResponse(
        jsonResponse({
          ...validResponse("created"),
          feed: { displayId: "feed_123456abcd", sourceHost: "news.example.org/rss.xml", state: "active", eligibleForRecheck: true }
        }, 201)
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
    await expect(
      parseFeedOnboardingResponse(jsonResponse({ ...validResponse("created"), message: "token=value" }, 201))
    ).resolves.toMatchObject({ kind: "invalid_response" });
  });
});

function validResponse(status: "created" | "already_exists" | "unavailable" | "rate_limited") {
  return {
    status,
    requestRef: status === "created" || status === "already_exists" ? "onboard_abc123def456" : null,
    feed: status === "unavailable" || status === "rate_limited"
      ? null
      : {
          displayId: "feed_123456abcd",
          sourceHost: "news.example.org",
          state: "active",
          eligibleForRecheck: true
        },
    nextSteps: ["Refresh Operations Drilldown."],
    message: status === "created"
      ? "Feed onboarding was accepted through the existing due-feed path."
      : "Feed onboarding request is safely bounded.",
    generatedAt: "2026-07-01T06:00:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const csrfToken = "csrf_token_value_at_least_32_characters";
const idempotencyKey = "onboard_1234567890abcdef";
