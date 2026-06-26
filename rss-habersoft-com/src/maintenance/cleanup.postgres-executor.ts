import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import type { MaintenanceConfig, RuntimeConfig } from "../configuration/runtime-config";
import { PostgresService } from "../persistence/postgres.service";
import type { CleanupStepExecutor } from "./cleanup.types";
import {
  AGENT_FEED_CHECK_EVENTS_RETENTION_HOURS,
  CLEANUP_AGE_DELETE_BATCH_SIZE,
  CLEANUP_EVENT_DELETE_BATCH_SIZE,
  CLEANUP_OVER_CAP_FEEDS_PER_RUN,
  CLEANUP_PER_FEED_DELETE_BATCH_SIZE
} from "./maintenance.registry";

type FeedIdRow = {
  readonly feed_id: bigint;
};

@Injectable()
export class CleanupPostgresExecutor implements CleanupStepExecutor {
  private readonly database: PrismaClient;
  private readonly config: MaintenanceConfig;

  public constructor(
    postgres: PostgresService,
    @Inject(RUNTIME_CONFIG) runtimeConfig: RuntimeConfig
  ) {
    if (runtimeConfig.maintenance === undefined) {
      throw new Error("maintenance configuration is required for cleanup executor");
    }

    this.database = postgres.database();
    this.config = runtimeConfig.maintenance;
  }

  public async runEntriesAgeRetention(): Promise<number> {
    let affectedRows = 0;

    for (;;) {
      const deleted = await this.database.$executeRaw`
        WITH doomed AS (
          SELECT id
          FROM entries
          WHERE created_at < now() - make_interval(days => ${this.config.entryRetentionDays}::integer)
          ORDER BY created_at ASC, id ASC
          LIMIT ${CLEANUP_AGE_DELETE_BATCH_SIZE}
        )
        DELETE FROM entries e
        USING doomed d
        WHERE e.id = d.id
      `;
      affectedRows += deleted;

      if (deleted === 0) {
        return affectedRows;
      }
    }
  }

  public async runEntriesPerFeedCap(): Promise<number> {
    const feedRows = await this.database.$queryRaw<FeedIdRow[]>`
      SELECT feed_id
      FROM entries
      GROUP BY feed_id
      HAVING COUNT(*) > ${this.config.entryMaxPerFeed}
      ORDER BY COUNT(*) DESC, feed_id ASC
      LIMIT ${CLEANUP_OVER_CAP_FEEDS_PER_RUN}
    `;

    let affectedRows = 0;
    for (const row of feedRows) {
      affectedRows += await this.database.$executeRaw`
        WITH keep AS (
          SELECT id
          FROM entries
          WHERE feed_id = ${row.feed_id}
          ORDER BY effective_at DESC, id DESC
          LIMIT ${this.config.entryMaxPerFeed}
        ),
        doomed AS (
          SELECT id
          FROM entries
          WHERE feed_id = ${row.feed_id}
            AND id NOT IN (SELECT id FROM keep)
          ORDER BY effective_at ASC, id ASC
          LIMIT ${CLEANUP_PER_FEED_DELETE_BATCH_SIZE}
        )
        DELETE FROM entries e
        USING doomed d
        WHERE e.id = d.id
      `;
    }

    return affectedRows;
  }

  public async runEntryDetailsAgeRetention(): Promise<number> {
    let affectedRows = 0;

    for (;;) {
      const deleted = await this.database.$transaction(async (transaction) =>
        transaction.$executeRaw`
          WITH doomed AS (
            SELECT entry_id
            FROM entry_details
            WHERE created_at < now() - make_interval(days => ${this.config.entryDetailRetentionDays}::integer)
            ORDER BY created_at ASC, entry_id ASC
            LIMIT ${CLEANUP_AGE_DELETE_BATCH_SIZE}
          ),
          updated AS (
            UPDATE entries e
            SET has_detail = false
            FROM doomed d
            WHERE e.id = d.entry_id
            RETURNING e.id AS entry_id
          )
          DELETE FROM entry_details ed
          USING updated u
          WHERE ed.entry_id = u.entry_id
        `
      );
      affectedRows += deleted;

      if (deleted === 0) {
        return affectedRows;
      }
    }
  }

  public async runEntryDetailsPerFeedCap(): Promise<number> {
    const feedRows = await this.database.$queryRaw<FeedIdRow[]>`
      SELECT feed_id
      FROM entry_details
      GROUP BY feed_id
      HAVING COUNT(*) > ${this.config.entryDetailMaxPerFeed}
      ORDER BY COUNT(*) DESC, feed_id ASC
      LIMIT ${CLEANUP_OVER_CAP_FEEDS_PER_RUN}
    `;

    let affectedRows = 0;
    for (const row of feedRows) {
      affectedRows += await this.database.$transaction(async (transaction) =>
        transaction.$executeRaw`
          WITH keep AS (
            SELECT entry_id
            FROM entry_details
            WHERE feed_id = ${row.feed_id}
            ORDER BY effective_at DESC, entry_id DESC
            LIMIT ${this.config.entryDetailMaxPerFeed}
          ),
          doomed AS (
            SELECT entry_id
            FROM entry_details
            WHERE feed_id = ${row.feed_id}
              AND entry_id NOT IN (SELECT entry_id FROM keep)
            ORDER BY effective_at ASC, entry_id ASC
            LIMIT ${CLEANUP_PER_FEED_DELETE_BATCH_SIZE}
          ),
          updated AS (
            UPDATE entries e
            SET has_detail = false
            FROM doomed d
            WHERE e.id = d.entry_id
            RETURNING e.id AS entry_id
          )
          DELETE FROM entry_details ed
          USING updated u
          WHERE ed.entry_id = u.entry_id
        `
      );
    }

    return affectedRows;
  }

  public async runAgentFeedCheckEventsAgeRetention(): Promise<number> {
    let affectedRows = 0;

    for (;;) {
      const deleted = await this.database.$executeRaw`
        WITH doomed AS (
          SELECT check_id
          FROM agent_feed_check_events
          WHERE created_at < now() - make_interval(hours => ${AGENT_FEED_CHECK_EVENTS_RETENTION_HOURS}::integer)
          ORDER BY created_at ASC, check_id ASC
          LIMIT ${CLEANUP_EVENT_DELETE_BATCH_SIZE}
        )
        DELETE FROM agent_feed_check_events e
        USING doomed d
        WHERE e.check_id = d.check_id
      `;
      affectedRows += deleted;

      if (deleted === 0) {
        return affectedRows;
      }
    }
  }

  public async runVacuumAnalyze(): Promise<number> {
    const commands = [
      Prisma.sql`VACUUM ANALYZE entries`,
      Prisma.sql`VACUUM ANALYZE entry_details`,
      Prisma.sql`VACUUM ANALYZE agent_feed_check_events`
    ] as const;

    let succeeded = 0;
    let firstError: unknown;

    for (const command of commands) {
      try {
        await this.database.$executeRaw(command);
        succeeded += 1;
      } catch (error: unknown) {
        firstError ??= error;
      }
    }

    if (firstError !== undefined) {
      throw firstError instanceof Error ? firstError : new Error("VACUUM ANALYZE failed");
    }

    return succeeded;
  }
}
