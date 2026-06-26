import { parseIncrexReply } from "../../src/tenant-rate-limit/redis-increx-reply";

describe("parseIncrexReply", () => {
  it("reads the current counter from Redis array replies", () => {
    expect(parseIncrexReply([1, 1])).toEqual({ ok: true, count: 1 });
    expect(parseIncrexReply(["12", "1"])).toEqual({ ok: true, count: 12 });
  });

  it("rejects malformed replies", () => {
    expect(parseIncrexReply(null)).toEqual({ ok: false });
    expect(parseIncrexReply([])).toEqual({ ok: false });
    expect(parseIncrexReply(["0", "1"])).toEqual({ ok: false });
    expect(parseIncrexReply(["not-a-number", "1"])).toEqual({ ok: false });
  });
});
