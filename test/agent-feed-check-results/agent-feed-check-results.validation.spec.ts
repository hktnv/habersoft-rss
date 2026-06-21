import { validateAgentFeedCheckResultsRequest } from "../../src/agent-feed-check-results/agent-feed-check-results.validation";

describe("validateAgentFeedCheckResultsRequest", () => {
  it("accepts canonical mixed non-entry results", () => {
    const result = validateAgentFeedCheckResultsRequest(validPayload(), {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results).toHaveLength(3);
      expect(result.value.results[0]).toEqual(expect.objectContaining({ feedId: 35n, outcome: "not_modified" }));
    }
  });

  it("rejects unknown root, query, and result fields", () => {
    for (const [payload, query] of [
      [{ ...validPayload(), check_id: "root" }, {}],
      [validPayload(), { retry: "1" }],
      [{ ...validPayload(), results: [{ ...notModified(), entries: [] }] }, {}]
    ] as const) {
      expect(validateAgentFeedCheckResultsRequest(payload, query)).toEqual({
        ok: false,
        errorCode: "VALIDATION_FAILED"
      });
    }
  });

  it("rejects empty and oversize result arrays", () => {
    expect(validateAgentFeedCheckResultsRequest({ results: [] }, {})).toEqual({
      ok: false,
      errorCode: "FEED_CHECK_RESULTS_EMPTY"
    });
    expect(
      validateAgentFeedCheckResultsRequest(
        { results: Array.from({ length: 251 }, (_, index) => notModified(`01K8Z3ABCD${index.toString().padStart(16, "0")}`)) },
        {}
      )
    ).toEqual({ ok: false, errorCode: "VALIDATION_FAILED" });
  });

  it("enforces identity, time, outcome, status, tier, and validator matrix", () => {
    for (const result of [
      { ...notModified(), check_id: "01k8z3abcd0000000000000001" },
      { ...notModified(), feed_id: "01" },
      { ...notModified(), checked_at: "2026-06-20T10:00:00" },
      { ...notModified(), outcome: "entries_found" },
      { ...notModified(), http_status: 200 },
      { ...notModified(), tier_attempted: 3 },
      (() => {
        const value = noNew();
        delete value.response_etag;
        return value;
      })(),
      { ...noNew(), response_etag: "e".repeat(1025) },
      { ...noNew(), response_last_modified: "m".repeat(257) },
      { ...fetchError(), response_etag: null },
      { ...fetchError(), error_code: null },
      { ...fetchError(), error_code: "E".repeat(101) },
      { ...fetchError(), http_status: 304 }
    ]) {
      expect(validateAgentFeedCheckResultsRequest({ results: [result] }, {})).toEqual({
        ok: false,
        errorCode: "VALIDATION_FAILED"
      });
    }
  });

  it("enforces feed_title rules", () => {
    expect(validateAgentFeedCheckResultsRequest({ results: [{ ...noNew(), feed_title: "Feed" }] }, {}).ok).toBe(true);

    for (const result of [
      { ...notModified(), feed_title: "Feed" },
      { ...fetchError(), feed_title: "Feed" },
      { ...noNew(), feed_title: "" },
      { ...noNew(), feed_title: " Feed" },
      { ...noNew(), feed_title: "f".repeat(301) }
    ]) {
      expect(validateAgentFeedCheckResultsRequest({ results: [result] }, {})).toEqual({
        ok: false,
        errorCode: "VALIDATION_FAILED"
      });
    }
  });
});

function validPayload(): Record<string, unknown> {
  return {
    flush_id: "01JZ7Q2M8W9ZKQ2P3R4T5Y6U7V",
    sent_at: "2026-06-20T10:00:03Z",
    results: [notModified(), noNew(), fetchError()]
  };
}

function notModified(checkId = "01K8Z3ABCD0000000000000001"): Record<string, unknown> {
  return {
    check_id: checkId,
    feed_id: "35",
    http_status: 304,
    outcome: "not_modified",
    checked_at: "2026-06-20T10:00:00Z",
    tier_attempted: 1,
    error_code: null,
    response_etag: '"etag"',
    response_last_modified: null
  };
}

function noNew(checkId = "01K8Z3ABCD0000000000000002"): Record<string, unknown> {
  return {
    check_id: checkId,
    feed_id: "36",
    http_status: 200,
    outcome: "no_new_entries",
    checked_at: "2026-06-20T10:00:01Z",
    tier_attempted: 1,
    error_code: null,
    response_etag: null,
    response_last_modified: "Sat, 20 Jun 2026 10:00:00 GMT",
    feed_title: "Feed title"
  };
}

function fetchError(checkId = "01K8Z3ABCD0000000000000003"): Record<string, unknown> {
  return {
    check_id: checkId,
    feed_id: "37",
    http_status: 403,
    outcome: "fetch_error",
    checked_at: "2026-06-20T10:00:02Z",
    tier_attempted: 2,
    error_code: "HTTP_403"
  };
}
