import { nextPhaseSlotAfter } from "../../src/agent-entries/agent-entries.policy";

describe("nextPhaseSlotAfter", () => {
  it("returns the next strict 15 minute phase slot for the feed id", () => {
    const createdAt = new Date("2026-06-20T10:00:00Z");
    const checkedAt = new Date("2026-06-20T10:15:35Z");

    expect(nextPhaseSlotAfter(checkedAt, 35n, createdAt).toISOString()).toBe("2026-06-20T10:30:35.000Z");
  });

  it("is strict when checked_at lands exactly on the phase slot", () => {
    const createdAt = new Date("2026-06-20T10:00:00Z");
    const checkedAt = new Date("2026-06-20T10:00:35Z");

    expect(nextPhaseSlotAfter(checkedAt, 35n, createdAt).toISOString()).toBe("2026-06-20T10:15:35.000Z");
  });
});
