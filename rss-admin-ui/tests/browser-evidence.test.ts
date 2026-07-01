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
      classifications: [
        "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
        "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
        "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
        "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
      ]
    });
    const serialized = serializeRedactedBrowserEvidence(evidence);
    expect(serialized).toContain("feed_onboarding_available");
    expect(serialized).toContain("critical_risk");
    expect(serialized).not.toMatch(/feed_recheck_v1\.|csrf|cookie|https?:\/\//iu);
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
    expect(evidence.feedOnboarding.effectStatus).toBe("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON");
    expect(validateRedactedBrowserEvidence(evidence)).toMatchObject({
      valid: true,
      classifications: [
        "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
        "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
        "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
        "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
        "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
      ]
    });
  });

  it("classifies accepted onboarding and accepted recheck effects without exposing action material", () => {
    const evidence = createRedactedBrowserEvidence(
      validDrilldown(),
      {
        feed_123456abcd: {
          result: {
            kind: "accepted",
            httpStatus: 202,
            response: {
              status: "accepted",
              requestId: "recheck_abc123def456",
              target: { displayId: "feed_123456abcd", sourceHost: "news.example.org" },
              queued: true,
              cooldownSeconds: 300,
              message: "Feed recheck was requested through the existing due-feed path.",
              generatedAt: "2026-07-01T10:01:00.000Z"
            }
          }
        }
      },
      {
        kind: "created",
        httpStatus: 201,
        response: {
          status: "created",
          requestRef: "onboard_abc123def456",
          feed: {
            displayId: "feed_123456abcd",
            sourceHost: "news.example.org",
            state: "active",
            eligibleForRecheck: true
          },
          nextSteps: ["Refresh Operations Drilldown."],
          message: "Feed onboarding was accepted through the existing due-feed path.",
          generatedAt: "2026-07-01T10:00:00.000Z"
        }
      }
    );

    expect(evidence.milestone).toBe("MS-027B");
    expect(evidence.feedOnboarding.effectStatus).toBe("FEED_ONBOARDING_EFFECT_ACCEPTED");
    expect(evidence.feedRecheck.effectStatus).toBe("FEED_RECHECK_EFFECT_ACCEPTED");
    expect(evidence.classifications).toEqual(expect.arrayContaining([
      "FEED_ONBOARDING_EFFECT_ACCEPTED",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
    ]));
    expect(serializeRedactedBrowserEvidence(evidence)).not.toMatch(/feed_recheck_v1\.|csrf|cookie|https?:\/\//iu);
  });

  it("classifies already-existing onboarding as regression-not-applicable instead of fresh effect acceptance", () => {
    const evidence = createRedactedBrowserEvidence(
      validDrilldown(),
      {
        feed_123456abcd: {
          result: {
            kind: "accepted",
            httpStatus: 202,
            response: {
              status: "accepted",
              requestId: "recheck_abc123def456",
              target: { displayId: "feed_123456abcd", sourceHost: "news.example.org" },
              queued: true,
              cooldownSeconds: 300,
              message: "Feed recheck was requested through the existing due-feed path.",
              generatedAt: "2026-07-01T10:01:00.000Z"
            }
          }
        }
      },
      {
        kind: "already_exists",
        httpStatus: 200,
        response: {
          status: "already_exists",
          requestRef: "onboard_abc123def456",
          feed: {
            displayId: "feed_123456abcd",
            sourceHost: "news.example.org",
            state: "active",
            eligibleForRecheck: true
          },
          nextSteps: ["Refresh Operations Drilldown."],
          message: "Feed already exists.",
          generatedAt: "2026-07-01T10:00:00.000Z"
        }
      }
    );

    expect(evidence.feedOnboarding.effectStatus).toBe("FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE");
    expect(evidence.feedOnboarding.feed_onboarding_status).toBe("already_present");
    expect(evidence.classifications).toEqual(expect.arrayContaining([
      "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
      "FEED_RECHECK_EFFECT_ACCEPTED"
    ]));
    expect(evidence.classifications).not.toContain("FEED_ONBOARDING_EFFECT_ACCEPTED");
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
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "available",
      no_eligible_target: true,
      critical_risk: "none",
      effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      lastActionClassification: null
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
      "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
    ]
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
