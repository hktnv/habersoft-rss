import {
  failureBackoffAfter,
  FEED_POLL_INTERVAL_SECONDS,
  nextPhaseSlotAfter
} from "../../src/agent-feed-check-results/agent-feed-check-results.policy";

describe("agent feed-check-results schedule policy", () => {
  it("keeps successful checks on the deterministic phase lane", () => {
    const createdAt = new Date("2026-06-20T00:00:00.000Z");
    const checkedAt = new Date("2026-06-20T00:15:00.000Z");

    expect(FEED_POLL_INTERVAL_SECONDS).toBe(900);
    expect(nextPhaseSlotAfter(checkedAt, 900n, createdAt).toISOString()).toBe("2026-06-20T00:30:00.000Z");
    expect(nextPhaseSlotAfter(checkedAt, 1799n, createdAt).toISOString()).toBe("2026-06-20T00:29:59.000Z");
    expect(nextPhaseSlotAfter(checkedAt, 9223372036854775807n, createdAt).toISOString()).toBe(
      "2026-06-20T00:15:07.000Z"
    );
  });

  it("calculates failure backoff from checked_at and caps exponent at six", () => {
    const checkedAt = new Date("2026-06-20T10:00:00.000Z");

    expect(failureBackoffAfter(checkedAt, 1).toISOString()).toBe("2026-06-20T10:30:00.000Z");
    expect(failureBackoffAfter(checkedAt, 2).toISOString()).toBe("2026-06-20T11:00:00.000Z");
    expect(failureBackoffAfter(checkedAt, 6).toISOString()).toBe("2026-06-21T02:00:00.000Z");
    expect(failureBackoffAfter(checkedAt, 9).toISOString()).toBe("2026-06-21T02:00:00.000Z");
  });
});
