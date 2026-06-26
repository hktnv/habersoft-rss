import { AgentKeyHeaderParser } from "../../src/agent-auth/agent-key-header.parser";

describe("AgentKeyHeaderParser", () => {
  const parser = new AgentKeyHeaderParser();

  it("accepts exactly one X-Agent-Key header without normalizing the value", () => {
    expect(
      parser.parse({
        headers: { "x-agent-key": "Secret Value" },
        rawHeaders: ["X-Agent-Key", "Secret Value"]
      })
    ).toEqual({ ok: true, candidate: "Secret Value" });
  });

  it("treats the public header name as case-insensitive", () => {
    expect(
      parser.parse({
        headers: { "X-Agent-Key": "secret" }
      })
    ).toEqual({ ok: true, candidate: "secret" });
  });

  it("rejects missing, empty, or array header values", () => {
    expect(parser.parse({ headers: {} })).toEqual({ ok: false, reason: "agent_key_header_missing" });
    expect(parser.parse({ headers: { "x-agent-key": "   " } })).toEqual({
      ok: false,
      reason: "agent_key_header_malformed"
    });
    expect(parser.parse({ headers: { "x-agent-key": ["a", "b"] } })).toEqual({
      ok: false,
      reason: "agent_key_header_multiple"
    });
  });

  it("rejects duplicate raw X-Agent-Key headers before reading a candidate", () => {
    expect(
      parser.parse({
        headers: { "x-agent-key": "one" },
        rawHeaders: ["X-Agent-Key", "one", "x-agent-key", "two"]
      })
    ).toEqual({ ok: false, reason: "agent_key_header_multiple" });
  });

  it("rejects duplicate case variants when raw headers are unavailable", () => {
    expect(
      parser.parse({
        headers: { "X-Agent-Key": "one", "x-agent-key": "two" }
      })
    ).toEqual({ ok: false, reason: "agent_key_header_multiple" });
  });

  it("does not accept query or body credential aliases", () => {
    expect(
      parser.parse({
        headers: {
          "x-agent-key-query": "secret",
          authorization: "Agent secret"
        }
      })
    ).toEqual({ ok: false, reason: "agent_key_header_missing" });
  });
});
