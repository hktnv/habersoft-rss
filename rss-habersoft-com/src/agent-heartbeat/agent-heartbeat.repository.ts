import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type { AgentHeartbeatWriteInput } from "./agent-heartbeat.types";

@Injectable()
export class AgentHeartbeatRepository {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async upsert(input: AgentHeartbeatWriteInput): Promise<void> {
    await this.database.agentRuntimeStatus.upsert({
      where: {
        agentId: input.agentId
      },
      create: {
        agentId: input.agentId,
        status: input.status,
        lastHeartbeatSentAt: input.sentAt,
        lastHeartbeatReceivedAt: input.receivedAt,
        feedsProcessed: input.feedsProcessed,
        errorsCount: input.errorsCount,
        staleCheckResultsDropped: input.staleCheckResultsDropped,
        staleEntriesDropped: input.staleEntriesDropped,
        updatedAt: input.receivedAt
      },
      update: {
        status: input.status,
        lastHeartbeatSentAt: input.sentAt,
        lastHeartbeatReceivedAt: input.receivedAt,
        feedsProcessed: input.feedsProcessed,
        errorsCount: input.errorsCount,
        staleCheckResultsDropped: input.staleCheckResultsDropped,
        staleEntriesDropped: input.staleEntriesDropped,
        updatedAt: input.receivedAt
      }
    });
  }
}
