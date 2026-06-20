import {
  validateAgentFeedId,
  validateAgentNewGuidsBody,
  validateAgentNewGuidsRequest
} from "../../src/agent-new-guids/agent-new-guids.validation";

describe("agent new GUID request validation", () => {
  it("accepts a positive bigint feed id and exact body shape", () => {
    expect(validateAgentNewGuidsRequest("9223372036854775807", { guids: ["abc", "https://example.test/a"] }, {})).toEqual({
      ok: true,
      value: {
        feedId: 9223372036854775807n,
        guids: ["abc", "https://example.test/a"]
      }
    });
  });

  it("rejects ambiguous or out-of-range feed ids", () => {
    for (const value of ["", "0", "01", "-1", "+1", "1.0", "1e2", " 1", "1 ", "9223372036854775808"]) {
      expect(validateAgentFeedId(value)).toEqual({ ok: false });
    }

    expect(validateAgentFeedId(1)).toEqual({ ok: false });
  });

  it("requires exactly the guids body field with 1 through 100 string items", () => {
    expect(validateAgentNewGuidsBody({ guids: ["one"] })).toEqual({ ok: true, value: ["one"] });
    expect(validateAgentNewGuidsBody({ guids: Array.from({ length: 100 }, (_, index) => `guid-${index}`) })).toMatchObject({
      ok: true
    });

    expect(validateAgentNewGuidsBody({})).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: [], status: 200 })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: [] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: Array.from({ length: 101 }, (_, index) => `guid-${index}`) })).toEqual({
      ok: false
    });
    expect(validateAgentNewGuidsBody({ guids: ["one", 2] })).toEqual({ ok: false });
  });

  it("rejects empty, whitespace-padded, and over-long GUID strings without coercion", () => {
    expect(validateAgentNewGuidsBody({ guids: [""] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: [" guid"] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: ["guid "] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: ["   "] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: ["x".repeat(2048)] })).toMatchObject({ ok: true });
    expect(validateAgentNewGuidsBody({ guids: ["x".repeat(2049)] })).toEqual({ ok: false });
    expect(validateAgentNewGuidsBody({ guids: ["😀".repeat(2048)] })).toMatchObject({ ok: true });
    expect(validateAgentNewGuidsBody({ guids: ["😀".repeat(2049)] })).toEqual({ ok: false });
  });

  it("rejects query parameters because the endpoint has no query contract", () => {
    expect(validateAgentNewGuidsRequest("1", { guids: ["abc"] }, { limit: "1" })).toEqual({ ok: false });
    expect(validateAgentNewGuidsRequest("1", { guids: ["abc"] }, [])).toEqual({ ok: false });
  });
});
