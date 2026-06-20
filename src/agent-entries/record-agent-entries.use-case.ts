import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import type { RuntimeConfig } from "../configuration/runtime-config";
import {
  AgentEntriesCheckedAtInFutureError,
  AgentEntriesCheckedAtTooOldError
} from "./agent-entries.error";
import { toAgentEntriesResponse } from "./agent-entries.mapper";
import { AgentEntriesWriter } from "./agent-entries.writer";
import { AGENT_ENTRIES_CLOCK, AgentEntriesClock } from "./agent-entries.clock";
import type { AgentEntriesRequest, AgentEntriesResponse } from "./agent-entries.types";

@Injectable()
export class RecordAgentEntriesUseCase {
  public constructor(
    @Inject(AgentEntriesWriter)
    private readonly writer: Pick<AgentEntriesWriter, "record">,
    @Inject(AGENT_ENTRIES_CLOCK)
    private readonly clock: AgentEntriesClock,
    @Inject(RUNTIME_CONFIG)
    private readonly config: RuntimeConfig
  ) {}

  public async execute(request: AgentEntriesRequest): Promise<AgentEntriesResponse> {
    const receivedAt = this.clock.now();
    this.assertCheckedAtWithinWindow(request.checkedAt, receivedAt);

    const result = await this.writer.record({
      ...request,
      receivedAt
    });

    return toAgentEntriesResponse(result);
  }

  private assertCheckedAtWithinWindow(checkedAt: Date, receivedAt: Date): void {
    const config = this.config.agentEntries;
    if (config === undefined) {
      throw new Error("agent_entries_config_missing");
    }

    const skewMs = checkedAt.getTime() - receivedAt.getTime();
    if (skewMs > config.checkedAtMaxFutureSkewSeconds * 1000) {
      throw new AgentEntriesCheckedAtInFutureError();
    }

    const ageMs = receivedAt.getTime() - checkedAt.getTime();
    if (ageMs > config.checkedAtMaxAgeSeconds * 1000) {
      throw new AgentEntriesCheckedAtTooOldError();
    }
  }
}
