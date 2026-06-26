import { validateAgentEntriesRequest } from "../../src/agent-entries/agent-entries.validation";

describe("validateAgentEntriesRequest", () => {
  it("accepts the canonical entries payload", () => {
    const result = validateAgentEntriesRequest(validPayload(), {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feedId).toBe(35n);
      expect(result.value.checkId).toBe("01K8Z3ABCD0000000000000001");
      expect(result.value.entries).toHaveLength(1);
      expect(result.value.entries[0]?.detailExtraction.status).toBe("ok");
    }
  });

  it("rejects unknown root, entry, detail, and query fields", () => {
    for (const [payload, query] of [
      [{ ...validPayload(), server_owned: true }, {}],
      [{ ...validPayload(), entries: [{ ...validEntry(), id: "1" }] }, {}],
      [
        {
          ...validPayload(),
          entries: [{ ...validEntry(), detail_extraction: { ...validDetailExtraction(), extra: true } }]
        },
        {}
      ],
      [validPayload(), { limit: "1" }]
    ] as const) {
      expect(validateAgentEntriesRequest(payload, query)).toEqual({ ok: false, errorCode: "VALIDATION_FAILED" });
    }
  });

  it("rejects malformed identity, time, tier, URL, and entry count values", () => {
    for (const payload of [
      { ...validPayload(), check_id: "01k8z3abcd0000000000000001" },
      { ...validPayload(), feed_id: "0" },
      { ...validPayload(), checked_at: "2026-06-20T10:00:00" },
      { ...validPayload(), tier_attempted: 3 },
      { ...validPayload(), entries: [] },
      { ...validPayload(), entries: Array.from({ length: 101 }, (_, index) => validEntry(`g-${index}`)) },
      { ...validPayload(), entries: [{ ...validEntry(), url: "ftp://example.test/a" }] },
      { ...validPayload(), entries: [{ ...validEntry(), guid: " duplicate" }] },
      { ...validPayload(), entries: [validEntry("same"), validEntry("same")] }
    ]) {
      expect(validateAgentEntriesRequest(payload, {})).toEqual({ ok: false, errorCode: "VALIDATION_FAILED" });
    }
  });

  it("enforces detail extraction consistency", () => {
    for (const entry of [
      { ...validEntry(), detail: null },
      { ...validEntry(), detail_extraction: { ...validDetailExtraction(), error_code: "SHOULD_NOT_EXIST" } },
      {
        ...validEntry(),
        detail: null,
        detail_extraction: {
          status: "timeout",
          attempted_at: null,
          finalized_at: "2026-06-20T10:00:02Z",
          error_code: "TIMEOUT"
        }
      },
      {
        ...validEntry(),
        detail: "body",
        detail_extraction: {
          status: "timeout",
          attempted_at: "2026-06-20T10:00:01Z",
          finalized_at: "2026-06-20T10:00:02Z",
          error_code: "TIMEOUT"
        }
      },
      {
        ...validEntry(),
        detail: null,
        detail_extraction: {
          status: "skipped_budget_exceeded",
          attempted_at: "2026-06-20T10:00:01Z",
          finalized_at: "2026-06-20T10:00:02Z",
          error_code: "ENRICHMENT_BUDGET_EXCEEDED"
        }
      }
    ]) {
      expect(validateAgentEntriesRequest({ ...validPayload(), entries: [entry] }, {})).toEqual({
        ok: false,
        errorCode: "VALIDATION_FAILED"
      });
    }
  });

  it("uses the canonical entry field limits from the active server contract", () => {
    const valid = {
      ...validEntry(),
      guid: "g".repeat(2048),
      summary: "s".repeat(2000),
      tags: ["t".repeat(50)],
      author: "a".repeat(200),
      meta: { value: "m".repeat(500) }
    };
    expect(validateAgentEntriesRequest({ ...validPayload(), entries: [valid] }, {}).ok).toBe(true);

    for (const entry of [
      { ...validEntry(), guid: "g".repeat(2049) },
      { ...validEntry(), summary: "s".repeat(2001) },
      { ...validEntry(), tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) },
      { ...validEntry(), tags: ["t".repeat(51)] },
      { ...validEntry(), author: "a".repeat(201) },
      { ...validEntry(), meta: { value: "m".repeat(501) } },
      { ...validEntry(), meta: { value: 1 } }
    ]) {
      expect(validateAgentEntriesRequest({ ...validPayload(), entries: [entry] }, {})).toEqual({
        ok: false,
        errorCode: "VALIDATION_FAILED"
      });
    }
  });

  it("requires RSS 200 validator fields and applies canonical validator/title limits", () => {
    for (const payload of [
      (() => {
        const value = validPayload();
        delete value.response_etag;
        return value;
      })(),
      (() => {
        const value = validPayload();
        delete value.response_last_modified;
        return value;
      })(),
      { ...validPayload(), response_etag: "e".repeat(1025) },
      { ...validPayload(), response_last_modified: "m".repeat(257) },
      { ...validPayload(), feed_title: "f".repeat(301) }
    ]) {
      expect(validateAgentEntriesRequest(payload, {})).toEqual({ ok: false, errorCode: "VALIDATION_FAILED" });
    }
  });
});

function validPayload(): Record<string, unknown> {
  return {
    check_id: "01K8Z3ABCD0000000000000001",
    feed_id: "35",
    checked_at: "2026-06-20T10:00:00Z",
    tier_attempted: 1,
    feed_title: "Feed title",
    response_etag: '"etag"',
    response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
    entries: [validEntry()]
  };
}

function validEntry(guid = "entry-guid"): Record<string, unknown> {
  return {
    guid,
    url: `https://example.test/${guid}`,
    title: "Entry title",
    summary: "Summary",
    images: ["https://example.test/image.jpg"],
    videos: [],
    tags: ["news"],
    author: "Author",
    meta: { source: "rss" },
    published_at: "2026-06-20T09:00:00Z",
    detail: "Article body",
    detail_extraction: validDetailExtraction()
  };
}

function validDetailExtraction(): Record<string, unknown> {
  return {
    status: "ok",
    attempted_at: "2026-06-20T10:00:01Z",
    finalized_at: "2026-06-20T10:00:02Z",
    error_code: null
  };
}
