import { AGENT_DUE_FEEDS_CLOCK } from "../../src/agent-due-feeds/agent-due-feeds.clock";
import { AgentDueFeedsReader } from "../../src/agent-due-feeds/agent-due-feeds.reader";
import { ListAgentDueFeedsUseCase } from "../../src/agent-due-feeds/list-agent-due-feeds.use-case";

const serverNow = new Date("2026-06-20T12:00:00.000Z");

describe("ListAgentDueFeedsUseCase", () => {
  it("captures server time once, reads limit+1 candidates, and slices the public response", async () => {
    const reader = {
      listDueFeeds: jest.fn().mockResolvedValue([
        { id: 1n, url: "https://example.test/1.xml", etag: null, lastModified: null },
        { id: 2n, url: "https://example.test/2.xml", etag: "\"two\"", lastModified: "Tue, 17 Jun 2026 01:00:00 GMT" }
      ])
    };
    const clock = { now: jest.fn().mockReturnValue(serverNow) };
    const useCase = new ListAgentDueFeedsUseCase(reader, clock);

    await expect(useCase.execute({ limit: 1 })).resolves.toEqual({
      feeds: [{ feed_id: "1", url: "https://example.test/1.xml", etag: null, last_modified: null }],
      feed_poll_interval_seconds: 900,
      has_more_due: true
    });
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(reader.listDueFeeds).toHaveBeenCalledTimes(1);
    expect(reader.listDueFeeds).toHaveBeenCalledWith({ limit: 2, serverNow });
  });

  it("returns has_more_due false when the reader has no extra candidate", async () => {
    const reader = {
      listDueFeeds: jest.fn().mockResolvedValue([
        { id: 1n, url: "https://example.test/1.xml", etag: null, lastModified: null }
      ])
    };
    const useCase = new ListAgentDueFeedsUseCase(reader, { now: jest.fn().mockReturnValue(serverNow) });

    await expect(useCase.execute({ limit: 1 })).resolves.toMatchObject({ has_more_due: false });
  });

  it("fails fast if the reader violates the bounded limit+1 contract", async () => {
    const reader = {
      listDueFeeds: jest.fn().mockResolvedValue([
        { id: 1n, url: "https://example.test/1.xml", etag: null, lastModified: null },
        { id: 2n, url: "https://example.test/2.xml", etag: null, lastModified: null },
        { id: 3n, url: "https://example.test/3.xml", etag: null, lastModified: null }
      ])
    };
    const useCase = new ListAgentDueFeedsUseCase(reader, { now: jest.fn().mockReturnValue(serverNow) });

    await expect(useCase.execute({ limit: 1 })).rejects.toThrow("agent_due_feeds_reader_returned_too_many_rows");
  });

  it("keeps use-case dependencies away from Nest provider tokens in direct tests", () => {
    expect(AgentDueFeedsReader).toBeDefined();
    expect(AGENT_DUE_FEEDS_CLOCK).toBeDefined();
  });
});
