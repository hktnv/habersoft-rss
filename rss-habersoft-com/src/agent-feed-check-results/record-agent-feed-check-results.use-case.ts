import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import type { RuntimeConfig } from "../configuration/runtime-config";
import { AGENT_FEED_CHECK_RESULTS_CLOCK, AgentFeedCheckResultsClock } from "./agent-feed-check-results.clock";
import {
  AgentFeedCheckResultsCheckedAtInFutureError,
  AgentFeedCheckResultsCheckedAtTooOldError
} from "./agent-feed-check-results.error";
import { toAgentFeedCheckResultsResponse } from "./agent-feed-check-results.mapper";
import type { AgentFeedCheckResultsRequest, AgentFeedCheckResultsResponse } from "./agent-feed-check-results.types";
import { AgentFeedCheckResultsWriter } from "./agent-feed-check-results.writer";

@Injectable()
export class RecordAgentFeedCheckResultsUseCase {
  public constructor(
    @Inject(AgentFeedCheckResultsWriter)
    private readonly writer: Pick<AgentFeedCheckResultsWriter, "record">,
    @Inject(AGENT_FEED_CHECK_RESULTS_CLOCK)
    private readonly clock: AgentFeedCheckResultsClock,
    @Inject(RUNTIME_CONFIG)
    private readonly config: RuntimeConfig
  ) {}

  public async execute(request: AgentFeedCheckResultsRequest): Promise<AgentFeedCheckResultsResponse> {
    const receivedAt = this.clock.now();
    for (const result of request.results) {
      this.assertCheckedAtWithinWindow(result.checkedAt, receivedAt);
    }

    const result = await this.writer.record({
      ...request,
      receivedAt
    });

    return toAgentFeedCheckResultsResponse(result);
  }

  private assertCheckedAtWithinWindow(checkedAt: Date, receivedAt: Date): void {
    const config = this.config.agentEntries;
    if (config === undefined) {
      throw new Error("agent_entries_config_missing");
    }

    const skewMs = checkedAt.getTime() - receivedAt.getTime();
    if (skewMs > config.checkedAtMaxFutureSkewSeconds * 1000) {
      throw new AgentFeedCheckResultsCheckedAtInFutureError();
    }

    const ageMs = receivedAt.getTime() - checkedAt.getTime();
    if (ageMs > config.checkedAtMaxAgeSeconds * 1000) {
      throw new AgentFeedCheckResultsCheckedAtTooOldError();
    }
  }
}
