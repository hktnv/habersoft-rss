import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { HealthService } from "../health/health.service";
import { PostgresService } from "../persistence/postgres.service";
import type { AdminOperationsSummary, AdminOperationsSummaryNote } from "./admin-operations-summary.types";

const recentHours = 24;
const successOutcomes = ["not_modified", "no_new_entries", "entries_found"] as const;
const failedOutcomes = ["fetch_error"] as const;

@Injectable()
export class AdminOperationsSummaryService {
  private readonly database: PrismaClient;

  public constructor(
    @Inject(PostgresService)
    postgres: Pick<PostgresService, "database">,
    private readonly health: HealthService
  ) {
    this.database = postgres.database();
  }

  public async readSummary(now: Date = new Date()): Promise<AdminOperationsSummary> {
    const notes: AdminOperationsSummaryNote[] = [];
    const since = new Date(now.getTime() - recentHours * 60 * 60 * 1000);
    const dependencies = await this.safeDependencies(notes);
    const metrics = await this.safeMetrics(now, since, notes);

    return {
      status: "ok",
      generatedAt: now.toISOString(),
      window: {
        recentHours
      },
      dependencies,
      ...metrics,
      notes
    };
  }

  private async safeDependencies(
    notes: AdminOperationsSummaryNote[]
  ): Promise<AdminOperationsSummary["dependencies"]> {
    try {
      const readiness = await this.health.readiness();
      return readiness.dependencies;
    } catch {
      notes.push({
        code: "dependency_status_unavailable",
        message: "Dependency status could not be fully checked without exposing raw diagnostics."
      });
      return {
        postgres: "unknown",
        redis: "unknown",
        tenantAuth: "unknown"
      };
    }
  }

  private async safeMetrics(
    now: Date,
    since: Date,
    notes: AdminOperationsSummaryNote[]
  ): Promise<Omit<AdminOperationsSummary, "status" | "generatedAt" | "window" | "dependencies" | "notes">> {
    try {
      const [
        feedsTotal,
        feedsActive,
        feedsDisabled,
        feedsDueNow,
        entriesTotal,
        entriesCreatedLast24h,
        checksLast24h,
        successLast24h,
        failedLast24h,
        latestCheck
      ] = await Promise.all([
        this.database.feed.count(),
        this.database.feed.count({ where: { active: true } }),
        this.database.feed.count({ where: { active: false } }),
        this.database.feed.count({ where: { active: true, nextCheckAt: { lte: now } } }),
        this.database.entry.count(),
        this.database.entry.count({ where: { createdAt: { gte: since } } }),
        this.database.agentFeedCheckEvent.count({ where: { checkedAt: { gte: since } } }),
        this.database.agentFeedCheckEvent.count({
          where: { checkedAt: { gte: since }, outcome: { in: [...successOutcomes] } }
        }),
        this.database.agentFeedCheckEvent.count({
          where: { checkedAt: { gte: since }, outcome: { in: [...failedOutcomes] } }
        }),
        this.database.agentFeedCheckEvent.findFirst({
          where: { checkedAt: { not: null } },
          orderBy: { checkedAt: "desc" },
          select: { checkedAt: true }
        })
      ]);

      notes.push({
        code: "summary_is_aggregate_only",
        message: "This dashboard exposes counts and dependency states only; it omits tenant, feed URL, entry content, log, and credential details."
      });

      return {
        feeds: {
          total: feedsTotal,
          active: feedsActive,
          disabled: feedsDisabled,
          dueNow: feedsDueNow
        },
        entries: {
          total: entriesTotal,
          createdLast24h: entriesCreatedLast24h
        },
        ingestion: {
          checksLast24h,
          successLast24h,
          failedLast24h,
          latestCheckAt: latestCheck?.checkedAt?.toISOString() ?? null
        }
      };
    } catch {
      notes.push({
        code: "operations_metrics_unavailable",
        message: "Aggregate operations metrics are temporarily unavailable; no raw rows or diagnostics were returned."
      });
      return nullMetrics();
    }
  }
}

function nullMetrics(): Omit<AdminOperationsSummary, "status" | "generatedAt" | "window" | "dependencies" | "notes"> {
  return {
    feeds: {
      total: null,
      active: null,
      disabled: null,
      dueNow: null
    },
    entries: {
      total: null,
      createdLast24h: null
    },
    ingestion: {
      checksLast24h: null,
      successLast24h: null,
      failedLast24h: null,
      latestCheckAt: null
    }
  };
}
