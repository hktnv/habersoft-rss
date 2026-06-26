import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import {
  AgentFeedCheckResultsCheckIdPayloadMismatchError,
  AgentFeedCheckResultsFeedNotFoundError
} from "./agent-feed-check-results.error";
import { FEED_POLL_INTERVAL_SECONDS, nextPhaseSlotAfter } from "./agent-feed-check-results.policy";
import type {
  AgentFeedCheckResultInput,
  AgentFeedCheckResultsWriteInput,
  AgentFeedCheckResultsWriteResult
} from "./agent-feed-check-results.types";

type TransactionClient = Prisma.TransactionClient;

type FeedProjection = {
  readonly id: bigint;
  readonly createdAt: Date | null;
};

type SeenCheck = {
  readonly feedId: bigint;
  readonly outcome: string;
};

@Injectable()
export class AgentFeedCheckResultsWriter {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async record(input: AgentFeedCheckResultsWriteInput): Promise<AgentFeedCheckResultsWriteResult> {
    try {
      return await this.recordInTransaction(input);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return this.recordInTransaction(input);
      }

      throw error;
    }
  }

  private async recordInTransaction(input: AgentFeedCheckResultsWriteInput): Promise<AgentFeedCheckResultsWriteResult> {
    return this.database.$transaction(async (transaction) => {
      const feeds = await this.loadFeeds(transaction, input.results);
      const seenChecks = new Map<string, SeenCheck>();
      let feedStateUpdated = 0;
      let idempotentReplayCount = 0;
      let outOfOrderResultCount = 0;

      for (const result of input.results) {
        const seen = seenChecks.get(result.checkId);
        if (seen !== undefined) {
          assertCompatible(seen, result);
          idempotentReplayCount += 1;
          continue;
        }

        const existing = await transaction.agentFeedCheckEvent.findUnique({
          where: { checkId: result.checkId },
          select: { feedId: true, outcome: true }
        });

        if (existing !== null) {
          assertCompatible({ feedId: existing.feedId ?? 0n, outcome: existing.outcome }, result);
          seenChecks.set(result.checkId, { feedId: result.feedId, outcome: result.outcome });
          idempotentReplayCount += 1;
          continue;
        }

        await transaction.agentFeedCheckEvent.create({
          data: {
            checkId: result.checkId,
            feedId: result.feedId,
            checkedAt: result.checkedAt,
            httpStatus: result.httpStatus,
            outcome: result.outcome,
            entriesSubmittedCount: 0,
            entriesSavedCount: 0,
            errorCode: result.errorCode,
            tierAttempted: result.tierAttempted,
            responseEtag: result.responseEtag,
            responseLastModified: result.responseLastModified,
            feedTitle: result.feedTitle,
            createdAt: input.receivedAt
          }
        });

        const feed = feeds.get(result.feedId.toString());
        if (feed === undefined || feed.createdAt === null) {
          throw new AgentFeedCheckResultsFeedNotFoundError();
        }

        const updated = await this.applyFeedState(transaction, result, feed);
        if (updated) {
          feedStateUpdated += 1;
        } else {
          outOfOrderResultCount += 1;
        }

        seenChecks.set(result.checkId, { feedId: result.feedId, outcome: result.outcome });
      }

      return {
        accepted: input.results.length,
        feedStateUpdated,
        idempotentReplayCount,
        outOfOrderResultCount
      };
    });
  }

  private async loadFeeds(
    transaction: TransactionClient,
    results: readonly AgentFeedCheckResultInput[]
  ): Promise<ReadonlyMap<string, FeedProjection>> {
    const feedIds = [...new Set(results.map((result) => result.feedId.toString()))].map((value) => BigInt(value));
    const feeds = await transaction.feed.findMany({
      where: { id: { in: feedIds } },
      select: { id: true, createdAt: true }
    });

    if (feeds.length !== feedIds.length) {
      throw new AgentFeedCheckResultsFeedNotFoundError();
    }

    return new Map(feeds.map((feed) => [feed.id.toString(), feed]));
  }

  private async applyFeedState(
    transaction: TransactionClient,
    result: AgentFeedCheckResultInput,
    feed: FeedProjection
  ): Promise<boolean> {
    if (result.outcome === "fetch_error") {
      const count = await transaction.$executeRaw(Prisma.sql`
        UPDATE feeds
        SET
          last_checked_at = ${result.checkedAt}::timestamptz,
          last_http_status = ${result.httpStatus}::smallint,
          error_count = COALESCE(error_count, 0) + 1,
          next_check_at = ${result.checkedAt}::timestamptz
            + make_interval(secs => ((${FEED_POLL_INTERVAL_SECONDS}::integer)
              * power(2, LEAST(COALESCE(error_count, 0) + 1, 6)))::integer)
        WHERE id = ${result.feedId}::bigint
          AND (last_checked_at IS NULL OR last_checked_at <= ${result.checkedAt}::timestamptz)
      `);

      return count === 1;
    }

    const nextCheckAt = nextPhaseSlotAfter(result.checkedAt, result.feedId, feed.createdAt ?? new Date(0));
    const responseValidatorData =
      result.outcome === "no_new_entries"
        ? {
            etag: result.responseEtag,
            lastModified: result.responseLastModified
          }
        : {
            ...(result.responseEtag === null ? {} : { etag: result.responseEtag }),
            ...(result.responseLastModified === null ? {} : { lastModified: result.responseLastModified })
          };

    const updated = await transaction.feed.updateMany({
      where: {
        id: result.feedId,
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: result.checkedAt } }]
      },
      data: {
        lastCheckedAt: result.checkedAt,
        lastHttpStatus: result.httpStatus,
        errorCount: 0,
        nextCheckAt,
        ...responseValidatorData,
        ...(result.feedTitle === null ? {} : { title: result.feedTitle })
      }
    });

    return updated.count === 1;
  }
}

function assertCompatible(existing: SeenCheck, result: AgentFeedCheckResultInput): void {
  if (existing.feedId !== result.feedId || existing.outcome !== result.outcome) {
    throw new AgentFeedCheckResultsCheckIdPayloadMismatchError();
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
