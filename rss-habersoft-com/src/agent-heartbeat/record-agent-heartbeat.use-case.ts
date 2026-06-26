import { Inject, Injectable } from "@nestjs/common";
import type { AgentPrincipal } from "../agent-auth/agent-auth.types";
import { AGENT_HEARTBEAT_CLOCK, AgentHeartbeatClock } from "./agent-heartbeat.clock";
import { AgentHeartbeatRepository } from "./agent-heartbeat.repository";
import type { AgentHeartbeatRequest } from "./agent-heartbeat.types";

@Injectable()
export class RecordAgentHeartbeatUseCase {
  public constructor(
    @Inject(AgentHeartbeatRepository)
    private readonly writer: Pick<AgentHeartbeatRepository, "upsert">,
    @Inject(AGENT_HEARTBEAT_CLOCK)
    private readonly clock: AgentHeartbeatClock
  ) {}

  public async execute(principal: AgentPrincipal, request: AgentHeartbeatRequest): Promise<void> {
    const receivedAt = this.clock.now();

    await this.writer.upsert({
      agentId: principal.agentId,
      status: request.status,
      sentAt: request.sentAt,
      receivedAt,
      feedsProcessed: request.feedsProcessed,
      errorsCount: request.errorsCount,
      staleCheckResultsDropped: request.staleCheckResultsDropped,
      staleEntriesDropped: request.staleEntriesDropped
    });
  }
}
