import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type { DueFeedReadInput, DueFeedRecord } from "./agent-due-feeds.types";

@Injectable()
export class AgentDueFeedsReader {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async listDueFeeds(input: DueFeedReadInput): Promise<readonly DueFeedRecord[]> {
    return this.database.feed.findMany({
      where: {
        active: true,
        subscriberCount: { gt: 0 },
        nextCheckAt: { lte: input.serverNow }
      },
      orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }],
      take: input.limit,
      select: {
        id: true,
        url: true,
        etag: true,
        lastModified: true
      }
    });
  }
}
