import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import {
  AgentEntriesCheckIdPayloadMismatchError,
  AgentEntriesFeedNotFoundError
} from "./agent-entries.error";
import { nextPhaseSlotAfter } from "./agent-entries.policy";
import type { AgentEntriesWriteInput, AgentEntriesWriteResult, AgentEntryInput } from "./agent-entries.types";

type TransactionClient = Prisma.TransactionClient;

type InsertedEntryRow = {
  readonly ord: number;
  readonly id: bigint;
  readonly feed_id: bigint;
  readonly guid: string;
  readonly effective_at: Date;
};

@Injectable()
export class AgentEntriesWriter {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async record(input: AgentEntriesWriteInput): Promise<AgentEntriesWriteResult> {
    const replay = await this.replayExistingEvent(input);
    if (replay !== undefined) {
      return replay;
    }

    try {
      return await this.database.$transaction(async (transaction) => {
        await transaction.agentFeedCheckEvent.create({
          data: {
            checkId: input.checkId,
            feedId: input.feedId,
            checkedAt: input.checkedAt,
            httpStatus: 200,
            outcome: "entries_found",
            entriesSubmittedCount: input.entries.length,
            entriesSavedCount: 0,
            errorCode: null,
            tierAttempted: input.tierAttempted,
            responseEtag: input.responseEtag,
            responseLastModified: input.responseLastModified,
            feedTitle: input.feedTitle,
            createdAt: input.receivedAt
          }
        });

        const feed = await transaction.feed.findUnique({
          where: { id: input.feedId },
          select: { id: true, createdAt: true }
        });

        if (feed === null || feed.createdAt === null) {
          throw new AgentEntriesFeedNotFoundError();
        }

        const insertedEntries = await this.insertNewEntries(transaction, input);
        await this.insertEntryDetails(transaction, input, insertedEntries);

        const entriesSavedCount = insertedEntries.length;
        await this.updateFeedState(transaction, input, feed.createdAt, entriesSavedCount);
        await transaction.agentFeedCheckEvent.update({
          where: { checkId: input.checkId },
          data: { entriesSavedCount }
        });

        return {
          entriesSavedCount,
          replay: false
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replayAfterRace = await this.replayExistingEvent(input);
        if (replayAfterRace !== undefined) {
          return replayAfterRace;
        }
      }

      throw error;
    }
  }

  private async replayExistingEvent(input: AgentEntriesWriteInput): Promise<AgentEntriesWriteResult | undefined> {
    const event = await this.database.agentFeedCheckEvent.findUnique({
      where: { checkId: input.checkId },
      select: {
        feedId: true,
        outcome: true,
        entriesSavedCount: true
      }
    });

    if (event === null) {
      return undefined;
    }

    if (event.feedId !== input.feedId || event.outcome !== "entries_found") {
      throw new AgentEntriesCheckIdPayloadMismatchError();
    }

    return {
      entriesSavedCount: event.entriesSavedCount,
      replay: true
    };
  }

  private async insertNewEntries(
    transaction: TransactionClient,
    input: AgentEntriesWriteInput
  ): Promise<readonly InsertedEntryRow[]> {
    const values = input.entries.map((entry, index) =>
      Prisma.sql`(
        ${index}::integer,
        ${input.feedId}::bigint,
        ${entry.guid}::text,
        ${entry.url}::text,
        ${entry.title}::text,
        ${entry.summary}::text,
        ${jsonb(entry.images)},
        ${jsonb(entry.videos)},
        ${jsonb(entry.tags)},
        ${entry.author}::text,
        ${jsonb(entry.meta)},
        ${entry.publishedAt}::timestamptz,
        ${input.checkedAt}::timestamptz,
        ${entry.detailExtraction.status}::text,
        ${entry.detailExtraction.errorCode}::text,
        ${entry.detailExtraction.attemptedAt}::timestamptz,
        ${entry.detailExtraction.finalizedAt}::timestamptz,
        ${entry.detailExtraction.status === "ok"}::boolean,
        ${input.receivedAt}::timestamptz
      )`
    );

    return transaction.$queryRaw<InsertedEntryRow[]>(Prisma.sql`
      WITH input(
        ord,
        feed_id,
        guid,
        url,
        title,
        summary,
        images,
        videos,
        tags,
        author,
        meta,
        published_at,
        first_seen_at,
        detail_extraction_status,
        detail_extraction_error_code,
        detail_extraction_attempted_at,
        detail_extraction_finalized_at,
        has_detail,
        created_at
      ) AS (
        VALUES ${Prisma.join(values)}
      ),
      inserted AS (
        INSERT INTO entries (
          feed_id,
          guid,
          url,
          title,
          summary,
          images,
          videos,
          tags,
          author,
          meta,
          published_at,
          first_seen_at,
          detail_extraction_status,
          detail_extraction_error_code,
          detail_extraction_attempted_at,
          detail_extraction_finalized_at,
          has_detail,
          created_at
        )
        SELECT
          input.feed_id,
          input.guid,
          input.url,
          input.title,
          input.summary,
          input.images,
          input.videos,
          input.tags,
          input.author,
          input.meta,
          input.published_at,
          input.first_seen_at,
          input.detail_extraction_status,
          input.detail_extraction_error_code,
          input.detail_extraction_attempted_at,
          input.detail_extraction_finalized_at,
          input.has_detail,
          input.created_at
        FROM input
        ON CONFLICT (feed_id, guid) DO NOTHING
        RETURNING id, feed_id, guid, effective_at
      )
      SELECT input.ord::int, inserted.id, inserted.feed_id, inserted.guid, inserted.effective_at
      FROM inserted
      INNER JOIN input ON input.feed_id = inserted.feed_id AND input.guid = inserted.guid
      ORDER BY input.ord ASC
    `);
  }

  private async insertEntryDetails(
    transaction: TransactionClient,
    input: AgentEntriesWriteInput,
    insertedEntries: readonly InsertedEntryRow[]
  ): Promise<void> {
    const byGuid = new Map(input.entries.map((entry) => [entry.guid, entry]));
    const rows = insertedEntries
      .map((inserted) => ({ inserted, entry: byGuid.get(inserted.guid) }))
      .filter(isOkDetailRow)
      .map(({ inserted, entry }) =>
        Prisma.sql`(
          ${inserted.id},
          ${inserted.feed_id},
          ${inserted.effective_at},
          ${entry.detail},
          char_length(${entry.detail}),
          ${input.receivedAt}
        )`
      );

    if (rows.length === 0) {
      return;
    }

    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO entry_details (
        entry_id,
        feed_id,
        effective_at,
        detail,
        detail_length,
        created_at
      )
      VALUES ${Prisma.join(rows)}
    `);
  }

  private async updateFeedState(
    transaction: TransactionClient,
    input: AgentEntriesWriteInput,
    feedCreatedAt: Date,
    entriesSavedCount: number
  ): Promise<void> {
    const nextCheckAt = nextPhaseSlotAfter(input.checkedAt, input.feedId, feedCreatedAt);

    await transaction.feed.updateMany({
      where: {
        id: input.feedId,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: input.checkedAt } }]
      },
      data: {
        lastCheckedAt: input.checkedAt,
        lastHttpStatus: 200,
        errorCount: 0,
        nextCheckAt,
        etag: input.responseEtag,
        lastModified: input.responseLastModified,
        ...(input.feedTitle === null ? {} : { title: input.feedTitle }),
        ...(entriesSavedCount > 0 ? { lastNewEntryAt: input.checkedAt } : {})
      }
    });
  }
}

function isOkDetailRow(value: {
  readonly inserted: InsertedEntryRow;
  readonly entry: AgentEntryInput | undefined;
}): value is { readonly inserted: InsertedEntryRow; readonly entry: AgentEntryInput & { readonly detail: string } } {
  return value.entry !== undefined && value.entry.detailExtraction.status === "ok" && value.entry.detail !== null;
}

function jsonb(value: unknown): Prisma.Sql {
  return value === null ? Prisma.sql`NULL::jsonb` : Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
