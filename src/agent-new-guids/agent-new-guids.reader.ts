import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type { ExistingGuidReadInput, ExistingGuidReadResult } from "./agent-new-guids.types";

@Injectable()
export class AgentNewGuidsReader {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async readExistingGuids(input: ExistingGuidReadInput): Promise<ExistingGuidReadResult | null> {
    const feed = await this.database.feed.findUnique({
      where: { id: input.feedId },
      select: { id: true }
    });

    if (feed === null) {
      return null;
    }

    const entries = await this.database.entry.findMany({
      where: {
        feedId: input.feedId,
        guid: { in: [...input.guids] }
      },
      select: { guid: true }
    });

    return {
      existingGuids: entries.map((entry) => entry.guid)
    };
  }
}
