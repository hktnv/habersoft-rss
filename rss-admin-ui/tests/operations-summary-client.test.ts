import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_OPERATIONS_SUMMARY_PATH,
  fetchOperationsSummary,
  operationsSummaryClientContract,
  parseOperationsSummaryResponse
} from "../src/adminOperations/operationsSummaryClient";

describe("operations summary client", () => {
  it("uses the same-origin protected admin-api contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(validSummary()));

    const result = await fetchOperationsSummary({ fetchImpl });

    expect(result.kind).toBe("success");
    expect(fetchImpl).toHaveBeenCalledWith(
      ADMIN_OPERATIONS_SUMMARY_PATH,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual"
      })
    );
    expect(operationsSummaryClientContract.browserPersistence).toBe(false);
    expect(operationsSummaryClientContract.customCredentialHeaders).toBe(false);
  });

  it("maps unauthenticated, unavailable, and malformed responses without raw bodies", async () => {
    await expect(parseOperationsSummaryResponse(jsonResponse({ reason: "unauthenticated" }, 401))).resolves.toMatchObject({
      kind: "unauthenticated",
      httpStatus: 401
    });
    await expect(parseOperationsSummaryResponse(jsonResponse({ reason: "admin_api_unavailable" }, 502))).resolves.toMatchObject({
      kind: "unavailable",
      httpStatus: 502
    });
    await expect(parseOperationsSummaryResponse(jsonResponse({ status: "ok", feeds: [{ url: "https://example.test/rss" }] }))).resolves.toMatchObject({
      kind: "invalid_response",
      httpStatus: 200
    });
  });
});

function validSummary() {
  return {
    status: "ok",
    generatedAt: "2026-06-30T06:00:00.000Z",
    window: { recentHours: 24 },
    dependencies: { postgres: "up", redis: "up", tenantAuth: "up" },
    feeds: { total: 10, active: 8, disabled: 2, dueNow: 1 },
    entries: { total: 100, createdLast24h: 12 },
    ingestion: {
      checksLast24h: 9,
      successLast24h: 7,
      failedLast24h: 1,
      latestCheckAt: "2026-06-30T05:00:00.000Z"
    },
    notes: [{ code: "summary_is_aggregate_only", message: "Aggregate counts only." }]
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
