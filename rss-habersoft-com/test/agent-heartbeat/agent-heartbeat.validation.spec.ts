import { validateAgentHeartbeatRequest } from "../../src/agent-heartbeat/agent-heartbeat.validation";

const validBody = {
  status: "ok",
  sent_at: "2026-06-17T02:05:00Z",
  feeds_processed: 500,
  errors_count: 2,
  stale_check_results_dropped: 0,
  stale_entries_dropped: 0
};

describe("validateAgentHeartbeatRequest", () => {
  it("accepts the canonical heartbeat body and preserves opaque status", () => {
    const result = validateAgentHeartbeatRequest({ ...validBody, status: "worker warm" });

    expect(result).toEqual({
      ok: true,
      value: {
        status: "worker warm",
        sentAt: new Date("2026-06-17T02:05:00Z"),
        feedsProcessed: 500,
        errorsCount: 2,
        staleCheckResultsDropped: 0,
        staleEntriesDropped: 0
      }
    });
  });

  it("rejects unknown fields and body-derived agent identifiers", () => {
    expect(validateAgentHeartbeatRequest({ ...validBody, debug: true })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, agent_id: "default" })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, agentId: "default" })).toEqual({ ok: false });
  });

  it("rejects missing, empty, or non-string status without inventing an enum", () => {
    expect(validateAgentHeartbeatRequest({ ...validBody, status: "" })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, status: "   " })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, status: 1 })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, status: "degraded" })).toMatchObject({ ok: true });
  });

  it("requires sent_at to be a timezone-aware valid instant without age or future skew rejection", () => {
    expect(validateAgentHeartbeatRequest({ ...validBody, sent_at: "2026-06-17T02:05:00" })).toEqual({
      ok: false
    });
    expect(validateAgentHeartbeatRequest({ ...validBody, sent_at: "not-a-date" })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, sent_at: "1999-01-01T00:00:00Z" })).toMatchObject({
      ok: true
    });
    expect(validateAgentHeartbeatRequest({ ...validBody, sent_at: "2999-01-01T00:00:00+03:00" })).toMatchObject({
      ok: true
    });
  });

  it("requires non-negative PostgreSQL int32 counters", () => {
    expect(validateAgentHeartbeatRequest({ ...validBody, feeds_processed: -1 })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, errors_count: 1.5 })).toEqual({ ok: false });
    expect(validateAgentHeartbeatRequest({ ...validBody, stale_check_results_dropped: 2147483648 })).toEqual({
      ok: false
    });
    expect(validateAgentHeartbeatRequest({ ...validBody, stale_entries_dropped: "0" })).toEqual({ ok: false });
  });
});
