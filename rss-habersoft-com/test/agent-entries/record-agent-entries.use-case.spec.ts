import {
  AgentEntriesCheckedAtInFutureError,
  AgentEntriesCheckedAtTooOldError
} from "../../src/agent-entries/agent-entries.error";
import { RecordAgentEntriesUseCase } from "../../src/agent-entries/record-agent-entries.use-case";
import type { AgentEntriesRequest, AgentEntriesWriteInput } from "../../src/agent-entries/agent-entries.types";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("RecordAgentEntriesUseCase", () => {
  const now = new Date("2026-06-20T10:10:00Z");
  let writer: { readonly record: jest.Mock<Promise<{ entriesSavedCount: number; replay: boolean }>, [AgentEntriesWriteInput]> };

  beforeEach(() => {
    writer = {
      record: jest
        .fn<Promise<{ entriesSavedCount: number; replay: boolean }>, [AgentEntriesWriteInput]>()
        .mockResolvedValue({ entriesSavedCount: 1, replay: false })
    };
  });

  it("passes a single received_at timestamp to the writer and maps the response", async () => {
    const useCase = new RecordAgentEntriesUseCase(writer, { now: () => now }, runtimeConfig);

    await expect(useCase.execute(request({ checkedAt: new Date("2026-06-20T10:09:00Z") }))).resolves.toEqual({
      saved: 1,
      idempotent_replay: false
    });
    expect(writer.record).toHaveBeenCalledWith(expect.objectContaining({ receivedAt: now }));
  });

  it("rejects checked_at before idempotency replay when outside the age window", async () => {
    const useCase = new RecordAgentEntriesUseCase(writer, { now: () => now }, runtimeConfig);

    await expect(useCase.execute(request({ checkedAt: new Date("2026-06-20T09:54:59Z") }))).rejects.toBeInstanceOf(
      AgentEntriesCheckedAtTooOldError
    );
    expect(writer.record).not.toHaveBeenCalled();
  });

  it("rejects checked_at values beyond allowed future skew", async () => {
    const useCase = new RecordAgentEntriesUseCase(writer, { now: () => now }, runtimeConfig);

    await expect(useCase.execute(request({ checkedAt: new Date("2026-06-20T10:11:01Z") }))).rejects.toBeInstanceOf(
      AgentEntriesCheckedAtInFutureError
    );
    expect(writer.record).not.toHaveBeenCalled();
  });
});

function request(overrides: Partial<AgentEntriesRequest> = {}): AgentEntriesRequest {
  return {
    checkId: "01K8Z3ABCD0000000000000001",
    feedId: 35n,
    checkedAt: new Date("2026-06-20T10:09:00Z"),
    tierAttempted: 1,
    feedTitle: "Feed",
    responseEtag: '"etag"',
    responseLastModified: "Sat, 20 Jun 2026 10:00:00 GMT",
    entries: [
      {
        guid: "guid-a",
        url: "https://example.test/a",
        title: "Title",
        summary: null,
        images: [],
        videos: [],
        tags: [],
        author: null,
        meta: null,
        publishedAt: null,
        detail: "body",
        detailExtraction: {
          status: "ok",
          attemptedAt: new Date("2026-06-20T10:09:01Z"),
          finalizedAt: new Date("2026-06-20T10:09:02Z"),
          errorCode: null
        }
      }
    ],
    ...overrides
  };
}
