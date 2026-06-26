import { validateAgentDueFeedsQuery } from "../../src/agent-due-feeds/agent-due-feeds.validation";

describe("validateAgentDueFeedsQuery", () => {
  it("accepts required decimal limit values from 1 through 500", () => {
    expect(validateAgentDueFeedsQuery({ limit: "1" })).toEqual({ ok: true, value: { limit: 1 } });
    expect(validateAgentDueFeedsQuery({ limit: "500" })).toEqual({ ok: true, value: { limit: 500 } });
  });

  it("rejects missing, unknown, repeated, or non-string query values", () => {
    expect(validateAgentDueFeedsQuery({})).toEqual({ ok: false });
    expect(validateAgentDueFeedsQuery({ limit: "1", offset: "0" })).toEqual({ ok: false });
    expect(validateAgentDueFeedsQuery({ limit: ["1", "2"] })).toEqual({ ok: false });
    expect(validateAgentDueFeedsQuery({ limit: 1 })).toEqual({ ok: false });
    expect(validateAgentDueFeedsQuery([])).toEqual({ ok: false });
  });

  it("rejects ambiguous or out-of-range limit strings without coercion or clamping", () => {
    for (const value of ["", "0", "01", "501", " 1", "1 ", "+1", "-1", "1.0", "1e2"]) {
      expect(validateAgentDueFeedsQuery({ limit: value })).toEqual({ ok: false });
    }
  });
});
