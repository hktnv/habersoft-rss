import { describe, expect, it } from "vitest";
import {
  REDACTED_BROWSER_EVIDENCE_SCHEMA,
  createRedactedBrowserEvidence,
  redactedBrowserEvidenceMaxBytes,
  serializeRedactedBrowserEvidence,
  validateRedactedBrowserEvidence,
  validateRedactedBrowserEvidenceText
} from "../src/adminOperations/browserEvidence";
import type { OperationsDrilldown } from "../src/adminOperations/operationsDrilldownClient";

describe("redacted browser evidence", () => {
  it("accepts valid minimal authenticated evidence", () => {
    const evidence = createRedactedBrowserEvidence(validDrilldown());
    const result = validateRedactedBrowserEvidence(evidence);

    expect(result).toMatchObject({
      valid: true,
      classifications: ["BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY", "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"]
    });
    expect(serializeRedactedBrowserEvidence(evidence)).not.toMatch(/feed_recheck_v1\.|csrf|cookie|https?:\/\//iu);
  });

  it("classifies no eligible feed evidence without failing the browser bridge", () => {
    const evidence = createRedactedBrowserEvidence({
      ...validDrilldown(),
      feeds: {
        ...validDrilldown().feeds,
        total: 0,
        active: 0,
        rows: []
      }
    });

    expect(evidence.feedRecheck.effectStatus).toBe("PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET");
    expect(validateRedactedBrowserEvidence(evidence)).toMatchObject({
      valid: true,
      classifications: ["BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY", "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"]
    });
  });

  it("rejects forbidden token, cookie, csrf, and actionRef surfaces", () => {
    for (const forbidden of [
      { ...minimalEvidence(), cookie: "habersoft_admin_session=abc" },
      { ...minimalEvidence(), csrfToken: "csrf_token_value_at_least_32_characters" },
      { ...minimalEvidence(), actionRef: `feed_recheck_v1.${"A".repeat(64)}` },
      { ...minimalEvidence(), operations: { ...minimalEvidence().operations, rawUrl: "https://news.example.test/feed.xml" } }
    ]) {
      expect(validateRedactedBrowserEvidence(forbidden)).toMatchObject({
        valid: false,
        classification: "BROWSER_EVIDENCE_INVALID"
      });
    }
  });

  it("rejects overlarge or untrusted body input", () => {
    const largeBody = `${" ".repeat(redactedBrowserEvidenceMaxBytes + 1)}{}`;

    expect(validateRedactedBrowserEvidenceText(largeBody)).toEqual({
      valid: false,
      classification: "BROWSER_EVIDENCE_INVALID",
      reason: "overlarge"
    });
    expect(validateRedactedBrowserEvidenceText("<html>not json</html>")).toEqual({
      valid: false,
      classification: "BROWSER_EVIDENCE_INVALID",
      reason: "invalid_json"
    });
  });

  it("rejects unknown fields instead of silently extending the schema", () => {
    expect(validateRedactedBrowserEvidence({ ...minimalEvidence(), extra: "unknown" })).toEqual({
      valid: false,
      classification: "BROWSER_EVIDENCE_INVALID",
      reason: "unknown_field"
    });
  });
});

function minimalEvidence() {
  return {
    schema: REDACTED_BROWSER_EVIDENCE_SCHEMA,
    source: "admin-ui",
    milestone: "MS-026C",
    generatedAt: "2026-07-01T10:00:00.000Z",
    authenticated: true,
    operations: {
      drilldownStatus: "ok",
      drilldownGeneratedAt: "2026-07-01T09:59:00.000Z",
      feeds: {
        total: 0,
        active: 0,
        rows: 0,
        eligibleRecheckTargets: 0,
        noEligibleFeedRecheckTarget: true
      },
      ingestion: {
        rows: 0,
        recentEntryCount: 0,
        recentBatchCount: 0
      }
    },
    feedRecheck: {
      effectStatus: "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
      lastActionClassification: null
    },
    classifications: ["BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY", "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"]
  } as const;
}

function validDrilldown(): OperationsDrilldown {
  return {
    status: "ok",
    generatedAt: "2026-07-01T10:00:00.000Z",
    window: { recentHours: 24, maxRows: 20 },
    feeds: {
      status: "ok",
      total: 1,
      active: 1,
      due: 1,
      withRecentSuccess: 1,
      withRecentFailure: 0,
      rows: [
        {
          displayId: "feed_123456abcd",
          displayName: "Example News",
          sourceHost: "news.example.org",
          health: "healthy",
          lastCheckedAt: "2026-07-01T09:55:00.000Z",
          lastResult: "success",
          recentEntryCount: 1,
          notes: [],
          canRequestRecheck: true,
          recheckUnavailableReason: null,
          actionRef: `feed_recheck_v1.${"A".repeat(64)}`
        }
      ]
    },
    ingestion: {
      status: "ok",
      recentEntryCount: 1,
      recentBatchCount: 1,
      latestEntryAt: "2026-07-01T09:58:00.000Z",
      rows: []
    },
    notes: [],
    capabilities: {
      feedRows: true,
      ingestionRows: true,
      reason: null
    }
  };
}
