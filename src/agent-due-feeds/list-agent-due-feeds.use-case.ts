import { Inject, Injectable } from "@nestjs/common";
import { AGENT_DUE_FEEDS_CLOCK, AgentDueFeedsClock } from "./agent-due-feeds.clock";
import { mapDueFeedRecord } from "./agent-due-feeds.mapper";
import { FEED_POLL_INTERVAL_SECONDS } from "./agent-due-feeds.policy";
import { AgentDueFeedsReader } from "./agent-due-feeds.reader";
import type { AgentDueFeedsQuery, DueFeedResponse } from "./agent-due-feeds.types";

@Injectable()
export class ListAgentDueFeedsUseCase {
  public constructor(
    @Inject(AgentDueFeedsReader)
    private readonly reader: Pick<AgentDueFeedsReader, "listDueFeeds">,
    @Inject(AGENT_DUE_FEEDS_CLOCK)
    private readonly clock: AgentDueFeedsClock
  ) {}

  public async execute(query: AgentDueFeedsQuery): Promise<DueFeedResponse> {
    const serverNow = this.clock.now();
    const candidateLimit = query.limit + 1;
    const candidates = await this.reader.listDueFeeds({
      limit: candidateLimit,
      serverNow
    });

    if (candidates.length > candidateLimit) {
      throw new Error("agent_due_feeds_reader_returned_too_many_rows");
    }

    return {
      feeds: candidates.slice(0, query.limit).map(mapDueFeedRecord),
      feed_poll_interval_seconds: FEED_POLL_INTERVAL_SECONDS,
      has_more_due: candidates.length > query.limit
    };
  }
}
