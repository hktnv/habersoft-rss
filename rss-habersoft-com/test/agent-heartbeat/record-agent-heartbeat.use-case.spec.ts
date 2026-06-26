import { RecordAgentHeartbeatUseCase } from "../../src/agent-heartbeat/record-agent-heartbeat.use-case";
import type { AgentHeartbeatRepository } from "../../src/agent-heartbeat/agent-heartbeat.repository";

describe("RecordAgentHeartbeatUseCase", () => {
  it("captures server time once and maps principal identity into the current-state write", async () => {
    const writer: jest.Mocked<Pick<AgentHeartbeatRepository, "upsert">> = {
      upsert: jest.fn().mockResolvedValue(undefined)
    };
    const receivedAt = new Date("2026-06-20T12:00:00.000Z");
    const useCase = new RecordAgentHeartbeatUseCase(writer, {
      now: jest.fn().mockReturnValue(receivedAt)
    });

    await useCase.execute(
      { agentId: "default" },
      {
        status: "ok",
        sentAt: new Date("2026-06-17T02:05:00.000Z"),
        feedsProcessed: 500,
        errorsCount: 2,
        staleCheckResultsDropped: 1,
        staleEntriesDropped: 0
      }
    );

    expect(writer.upsert).toHaveBeenCalledWith({
      agentId: "default",
      status: "ok",
      sentAt: new Date("2026-06-17T02:05:00.000Z"),
      receivedAt,
      feedsProcessed: 500,
      errorsCount: 2,
      staleCheckResultsDropped: 1,
      staleEntriesDropped: 0
    });
  });
});
