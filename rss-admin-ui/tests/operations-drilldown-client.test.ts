import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_OPERATIONS_DRILLDOWN_PATH,
  fetchOperationsDrilldown,
  operationsDrilldownClientContract,
  parseOperationsDrilldownResponse
} from "../src/adminOperations/operationsDrilldownClient";

describe("operations drilldown client", () => {
  it("uses the same-origin protected admin-api drilldown contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validDrilldown()));

    const result = await fetchOperationsDrilldown({ fetchImpl });

    expect(result.kind).toBe("success");
    expect(fetchImpl).toHaveBeenCalledWith(
      ADMIN_OPERATIONS_DRILLDOWN_PATH,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual"
      })
    );
    expect(operationsDrilldownClientContract.browserPersistence).toBe(false);
    expect(operationsDrilldownClientContract.customCredentialHeaders).toBe(false);
    expect(operationsDrilldownClientContract.polling).toBe(false);
    expect(operationsDrilldownClientContract.writeMethods).toBe(false);
  });

  it("maps unauthenticated, unavailable, and malformed responses without raw bodies", async () => {
    await expect(parseOperationsDrilldownResponse(jsonResponse({ reason: "unauthenticated" }, 401))).resolves.toMatchObject({
      kind: "unauthenticated",
      httpStatus: 401
    });
    await expect(parseOperationsDrilldownResponse(jsonResponse({ reason: "admin_api_unavailable" }, 502))).resolves.toMatchObject({
      kind: "unavailable",
      httpStatus: 502
    });
    await expect(parseOperationsDrilldownResponse(jsonResponse({ status: "ok", feeds: [{ url: "https://example.test/rss" }] }))).resolves.toMatchObject({
      kind: "invalid_response",
      httpStatus: 200
    });
  });

  it("rejects raw source URLs, oversized rows, and unsafe note text", async () => {
    await expect(
      parseOperationsDrilldownResponse(
        jsonResponse({
          ...validDrilldown(),
          feeds: {
            ...validDrilldown().feeds,
            rows: [
              {
                ...validDrilldown().feeds.rows[0],
                sourceHost: "news.example.org/rss.xml?token=secret"
              }
            ]
          }
        })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });

    await expect(
      parseOperationsDrilldownResponse(
        jsonResponse({
          ...validDrilldown(),
          notes: ["database_url=postgresql://redacted"]
        })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });

    await expect(
      parseOperationsDrilldownResponse(
        jsonResponse({
          ...validDrilldown(),
          ingestion: {
            ...validDrilldown().ingestion,
            rows: Array.from({ length: 21 }, () => validDrilldown().ingestion.rows[0])
          }
        })
      )
    ).resolves.toMatchObject({ kind: "invalid_response" });
  });
});

function validDrilldown() {
  return {
    status: "partial",
    generatedAt: "2026-06-30T06:00:00.000Z",
    window: { recentHours: 24, maxRows: 20 },
    feeds: {
      status: "partial",
      total: 2,
      active: 1,
      due: 1,
      withRecentSuccess: 1,
      withRecentFailure: 1,
      rows: [
        {
          displayId: "feed_123456abcd",
          displayName: "Example News",
          sourceHost: "news.example.org",
          health: "degraded",
          lastCheckedAt: "2026-06-30T05:00:00.000Z",
          lastResult: "failure",
          recentEntryCount: 3,
          notes: ["Latest check is degraded."]
        }
      ]
    },
    ingestion: {
      status: "ok",
      recentEntryCount: 3,
      recentBatchCount: 2,
      latestEntryAt: "2026-06-30T05:55:00.000Z",
      rows: [
        {
          displayId: "check_abcdef1234",
          feedDisplayId: "feed_123456abcd",
          receivedAt: "2026-06-30T05:45:00.000Z",
          entryCount: 2,
          status: "accepted",
          notes: []
        }
      ]
    },
    notes: ["Drilldown rows are bounded and safe."],
    capabilities: {
      feedRows: true,
      ingestionRows: true,
      reason: "Some source hosts were redacted."
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
