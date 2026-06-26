import { RecordAgentFeedCheckResultsUseCase } from "../../src/agent-feed-check-results/record-agent-feed-check-results.use-case";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("RecordAgentFeedCheckResultsUseCase", () => {
  it("maps writer counters to the exact public response", async () => {
    const writer = {
      record: jest.fn().mockResolvedValue({
        accepted: 3,
        feedStateUpdated: 1,
        idempotentReplayCount: 1,
        outOfOrderResultCount: 1
      })
    };
    const useCase = new RecordAgentFeedCheckResultsUseCase(writer, { now: () => new Date("2026-06-20T10:00:00Z") }, runtimeConfig);

    await expect(useCase.execute({ flushId: null, sentAt: null, results: [result()] })).resolves.toEqual({
      accepted: 3,
      feed_state_updated: 1,
      idempotent_replay_count: 1,
      out_of_order_result_count: 1
    });
  });

  it("checks the time window before writing", async () => {
    const writer = { record: jest.fn() };
    const useCase = new RecordAgentFeedCheckResultsUseCase(writer, { now: () => new Date("2026-06-20T10:00:00Z") }, runtimeConfig);

    await expect(
      useCase.execute({ flushId: null, sentAt: null, results: [result(new Date("2026-06-20T09:44:59Z"))] })
    ).rejects.toThrow("agent_feed_check_results_checked_at_too_old");
    expect(writer.record).not.toHaveBeenCalled();
  });
});

function result(checkedAt = new Date("2026-06-20T10:00:00Z")) {
  return {
    checkId: "01K8Z3ABCD0000000000000001",
    feedId: 35n,
    checkedAt,
    outcome: "not_modified" as const,
    httpStatus: 304,
    errorCode: null,
    tierAttempted: 1,
    responseEtag: null,
    responseLastModified: null,
    feedTitle: null
  };
}
