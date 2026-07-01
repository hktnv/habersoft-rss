import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import type {
  AdminOperationsDrilldown,
  AdminOperationsDrilldownStatus,
  AdminOperationsFeedHealth,
  AdminOperationsFeedRow,
  AdminOperationsIngestionRow,
  AdminOperationsIngestionRowStatus,
  AdminOperationsLastResult
} from "./admin-operations-drilldown.types";

const recentHours = 24;
const maxRows = 20;
const successOutcomes = ["not_modified", "no_new_entries", "entries_found"] as const;
const failedOutcomes = ["fetch_error"] as const;
const safeCodePattern = /^[A-Za-z0-9_. -]{1,64}$/u;
const unsafeTextPattern = /(?:secret|password|token|cookie|authorization|bearer|database_url|redis_url)\s*[:=]/iu;

@Injectable()
export class AdminOperationsDrilldownService {
  private readonly database: PrismaClient;

  public constructor(
    @Inject(PostgresService)
    postgres: Pick<PostgresService, "database">
  ) {
    this.database = postgres.database();
  }

  public async readDrilldown(now: Date = new Date()): Promise<AdminOperationsDrilldown> {
    const notes: string[] = [
      "Drilldown rows are bounded, read-only, and omit raw feed URLs, entry content, logs, credentials, and tenant data."
    ];
    const since = new Date(now.getTime() - recentHours * 60 * 60 * 1000);
    const [feeds, ingestion] = await Promise.all([
      this.safeFeeds(now, since, notes),
      this.safeIngestion(since, notes)
    ]);
    const status = combineStatus(feeds.status, ingestion.status);
    const reason = status === "ok" ? null : "Some drilldown data could not be read safely; unavailable fields are null.";

    return {
      status,
      generatedAt: now.toISOString(),
      window: {
        recentHours,
        maxRows
      },
      feeds,
      ingestion,
      notes: uniqueSafeNotes(notes),
      capabilities: {
        feedRows: feeds.status !== "unavailable",
        ingestionRows: ingestion.status !== "unavailable",
        reason
      }
    };
  }

  private async safeFeeds(
    now: Date,
    since: Date,
    globalNotes: string[]
  ): Promise<AdminOperationsDrilldown["feeds"]> {
    try {
      const [total, active, due, recentSuccessFeeds, recentFailureFeeds, feedRows, recentEntryGroups] =
        await Promise.all([
          this.database.feed.count(),
          this.database.feed.count({ where: { active: true } }),
          this.database.feed.count({ where: { active: true, nextCheckAt: { lte: now } } }),
          this.database.agentFeedCheckEvent.groupBy({
            by: ["feedId"],
            where: {
              feedId: { not: null },
              checkedAt: { gte: since },
              outcome: { in: [...successOutcomes] }
            }
          }),
          this.database.agentFeedCheckEvent.groupBy({
            by: ["feedId"],
            where: {
              feedId: { not: null },
              checkedAt: { gte: since },
              outcome: { in: [...failedOutcomes] }
            }
          }),
          this.database.feed.findMany({
            orderBy: [{ active: "desc" }, { nextCheckAt: "asc" }, { id: "asc" }],
            take: maxRows,
            select: {
              id: true,
              url: true,
              title: true,
              active: true,
              lastCheckedAt: true,
              lastHttpStatus: true,
              errorCount: true,
              nextCheckAt: true
            }
          }),
          this.database.entry.groupBy({
            by: ["feedId"],
            where: {
              createdAt: { gte: since }
            },
            _count: {
              _all: true
            }
          })
        ]);

      const feedIds = feedRows.map((feed) => feed.id);
      const recentChecks =
        feedIds.length === 0
          ? []
          : await this.database.agentFeedCheckEvent.findMany({
              where: {
                feedId: { in: feedIds },
                checkedAt: { not: null }
              },
              orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
              take: maxRows * 4,
              select: {
                feedId: true,
                checkedAt: true,
                outcome: true,
                entriesSavedCount: true,
                entriesSubmittedCount: true,
                errorCode: true,
                httpStatus: true
              }
            });

      const latestCheckByFeed = new Map<string, (typeof recentChecks)[number]>();
      for (const check of recentChecks) {
        if (check.feedId === null) continue;
        const key = String(check.feedId);
        if (!latestCheckByFeed.has(key)) latestCheckByFeed.set(key, check);
      }

      const recentEntryCountByFeed = new Map<string, number>();
      for (const group of recentEntryGroups) {
        recentEntryCountByFeed.set(String(group.feedId), group._count._all);
      }

      let redactedSourceHosts = 0;
      const rows = feedRows.map((feed) => {
        const latestCheck = latestCheckByFeed.get(String(feed.id));
        const sourceHost = safeSourceHost(feed.url);
        if (sourceHost === null) redactedSourceHosts += 1;
        return feedRow(feed, latestCheck, sourceHost, recentEntryCountByFeed.get(String(feed.id)) ?? 0, now);
      });

      const sectionNotes: string[] = [];
      if (redactedSourceHosts > 0) {
        sectionNotes.push("One or more source hosts were redacted because only public hostnames are rendered.");
        globalNotes.push("Some feed source hosts were redacted; raw feed URL paths and queries are never returned.");
      }

      return {
        status: redactedSourceHosts > 0 ? "partial" : "ok",
        total,
        active,
        due,
        withRecentSuccess: recentSuccessFeeds.length,
        withRecentFailure: recentFailureFeeds.length,
        rows: rows.map((row) =>
          sectionNotes.length > 0 && row.sourceHost === null
            ? { ...row, notes: uniqueSafeNotes([...row.notes, ...sectionNotes]) }
            : row
        )
      };
    } catch {
      globalNotes.push("Feed drilldown metrics are temporarily unavailable; no raw diagnostics were returned.");
      return unavailableFeeds();
    }
  }

  private async safeIngestion(
    since: Date,
    globalNotes: string[]
  ): Promise<AdminOperationsDrilldown["ingestion"]> {
    try {
      const [recentEntryCount, recentBatchCount, latestEntry, recentChecks] = await Promise.all([
        this.database.entry.count({ where: { createdAt: { gte: since } } }),
        this.database.agentFeedCheckEvent.count({ where: { checkedAt: { gte: since } } }),
        this.database.entry.findFirst({
          where: { createdAt: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        }),
        this.database.agentFeedCheckEvent.findMany({
          where: {
            checkedAt: { gte: since }
          },
          orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }],
          take: maxRows,
          select: {
            checkId: true,
            feedId: true,
            checkedAt: true,
            createdAt: true,
            outcome: true,
            entriesSubmittedCount: true,
            entriesSavedCount: true,
            errorCode: true,
            httpStatus: true
          }
        })
      ]);

      return {
        status: "ok",
        recentEntryCount,
        recentBatchCount,
        latestEntryAt: latestEntry?.createdAt?.toISOString() ?? null,
        rows: recentChecks.map(ingestionRow)
      };
    } catch {
      globalNotes.push("Ingestion drilldown metrics are temporarily unavailable; no raw diagnostics were returned.");
      return unavailableIngestion();
    }
  }
}

function feedRow(
  feed: {
    readonly id: bigint;
    readonly url: string;
    readonly title: string | null;
    readonly active: boolean | null;
    readonly lastCheckedAt: Date | null;
    readonly lastHttpStatus: number | null;
    readonly errorCount: number | null;
    readonly nextCheckAt: Date | null;
  },
  latestCheck:
    | {
        readonly checkedAt: Date | null;
        readonly outcome: string;
        readonly entriesSavedCount: number;
        readonly entriesSubmittedCount: number;
        readonly errorCode: string | null;
        readonly httpStatus: number | null;
      }
    | undefined,
  sourceHost: string | null,
  recentEntryCount: number,
  now: Date
): AdminOperationsFeedRow {
  const lastResult = classifyLastResult(latestCheck);
  const notes = feedNotes(feed, latestCheck, sourceHost, now);

  return {
    displayId: displayId("feed", feed.id),
    displayName: safeDisplayText(feed.title),
    sourceHost,
    health: classifyFeedHealth(feed, latestCheck, recentEntryCount, lastResult),
    lastCheckedAt: latestCheck?.checkedAt?.toISOString() ?? feed.lastCheckedAt?.toISOString() ?? null,
    lastResult,
    recentEntryCount,
    notes
  };
}

function ingestionRow(check: {
  readonly checkId: string;
  readonly feedId: bigint | null;
  readonly checkedAt: Date | null;
  readonly createdAt: Date | null;
  readonly outcome: string;
  readonly entriesSubmittedCount: number;
  readonly entriesSavedCount: number;
  readonly errorCode: string | null;
  readonly httpStatus: number | null;
}): AdminOperationsIngestionRow {
  return {
    displayId: displayId("check", check.checkId),
    feedDisplayId: check.feedId === null ? null : displayId("feed", check.feedId),
    receivedAt: check.checkedAt?.toISOString() ?? check.createdAt?.toISOString() ?? null,
    entryCount: safeCount(check.entriesSavedCount),
    status: classifyIngestionStatus(check),
    notes: ingestionNotes(check)
  };
}

function classifyFeedHealth(
  feed: {
    readonly active: boolean | null;
    readonly lastHttpStatus: number | null;
    readonly errorCount: number | null;
  },
  latestCheck: { readonly httpStatus: number | null } | undefined,
  recentEntryCount: number,
  lastResult: AdminOperationsLastResult
): AdminOperationsFeedHealth {
  if (feed.active === false) return "unknown";
  if (lastResult === "failure" || (feed.errorCount ?? 0) > 0 || isHttpFailure(latestCheck?.httpStatus ?? feed.lastHttpStatus)) {
    return "degraded";
  }
  if (lastResult === "success" || recentEntryCount > 0 || isHttpSuccess(feed.lastHttpStatus)) return "healthy";
  return "unknown";
}

function classifyLastResult(
  check:
    | {
        readonly outcome: string;
        readonly errorCode: string | null;
        readonly httpStatus: number | null;
      }
    | undefined
): AdminOperationsLastResult {
  if (check === undefined) return "unknown";
  if (successOutcomes.includes(check.outcome as (typeof successOutcomes)[number])) return "success";
  if (failedOutcomes.includes(check.outcome as (typeof failedOutcomes)[number])) return "failure";
  if (check.errorCode !== null || isHttpFailure(check.httpStatus)) return "failure";
  return "unknown";
}

function classifyIngestionStatus(check: {
  readonly outcome: string;
  readonly entriesSubmittedCount: number;
  readonly entriesSavedCount: number;
  readonly errorCode: string | null;
  readonly httpStatus: number | null;
}): AdminOperationsIngestionRowStatus {
  if (check.entriesSavedCount > 0) return "accepted";
  if (check.outcome === "not_modified" || check.outcome === "no_new_entries" || check.entriesSubmittedCount === 0) return "skipped";
  if (check.errorCode !== null || isHttpFailure(check.httpStatus)) return "unknown";
  return "unknown";
}

function feedNotes(
  feed: {
    readonly active: boolean | null;
    readonly lastHttpStatus: number | null;
    readonly errorCount: number | null;
    readonly nextCheckAt: Date | null;
  },
  latestCheck:
    | {
        readonly outcome: string;
        readonly errorCode: string | null;
        readonly httpStatus: number | null;
      }
    | undefined,
  sourceHost: string | null,
  now: Date
): readonly string[] {
  const notes: string[] = [];
  if (sourceHost === null) notes.push("Source host redacted.");
  if (feed.active === false) notes.push("Feed is inactive.");
  if (feed.nextCheckAt !== null && feed.nextCheckAt.getTime() <= now.getTime()) notes.push("Next check is due.");
  if ((feed.errorCount ?? 0) > 0) notes.push("Recent feed errors are present.");
  if (classifyLastResult(latestCheck) === "failure") notes.push("Latest check is degraded.");
  if (latestCheck?.errorCode !== null && safeCode(latestCheck?.errorCode)) notes.push("Safe error code reported.");
  if (isHttpFailure(latestCheck?.httpStatus ?? feed.lastHttpStatus)) notes.push("HTTP failure status reported.");
  return uniqueSafeNotes(notes);
}

function ingestionNotes(check: {
  readonly errorCode: string | null;
  readonly httpStatus: number | null;
  readonly entriesSubmittedCount: number;
  readonly entriesSavedCount: number;
}): readonly string[] {
  const notes: string[] = [];
  if (check.entriesSavedCount === 0) notes.push("No saved entries in this check.");
  if (check.entriesSubmittedCount > check.entriesSavedCount) notes.push("Some submitted entries were not saved.");
  if (safeCode(check.errorCode)) notes.push("Safe error code reported.");
  if (isHttpFailure(check.httpStatus)) notes.push("HTTP failure status reported.");
  return uniqueSafeNotes(notes);
}

function displayId(prefix: "feed" | "check", value: bigint | string): string {
  const digest = createHash("sha256").update(`${prefix}:${String(value)}`).digest("hex").slice(0, 10);
  return `${prefix}_${digest}`;
}

function safeSourceHost(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostname.length < 1 || hostname.length > 120 || hostname.includes("/") || hostname.includes("?")) return null;
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (hostname.endsWith(".lan") || hostname.endsWith(".home") || hostname.endsWith(".corp")) return null;
  if (hostname.includes(":")) return null;
  if (isPrivateIpv4(hostname)) return null;
  if (!hostname.includes(".")) return null;
  return hostname;
}

function safeDisplayText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "" || unsafeTextPattern.test(normalized)) return null;
  if (/https?:\/\//iu.test(normalized)) return null;
  return normalized.slice(0, 80);
}

function safeCode(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && safeCodePattern.test(value) && !unsafeTextPattern.test(value);
}

function safeCount(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function uniqueSafeNotes(notes: readonly string[]): readonly string[] {
  return [...new Set(notes.map(safeNote).filter((note): note is string => note !== null))].slice(0, 12);
}

function safeNote(note: string): string | null {
  const normalized = note.replace(/\s+/gu, " ").trim();
  if (normalized === "" || normalized.length > 180 || unsafeTextPattern.test(normalized)) return null;
  if (/https?:\/\/|\/admin-auth\/|\/api\//iu.test(normalized)) return null;
  return normalized;
}

function combineStatus(
  left: AdminOperationsDrilldownStatus,
  right: AdminOperationsDrilldownStatus
): AdminOperationsDrilldownStatus {
  if (left === "unavailable" && right === "unavailable") return "unavailable";
  if (left === "ok" && right === "ok") return "ok";
  return "partial";
}

function unavailableFeeds(): AdminOperationsDrilldown["feeds"] {
  return {
    status: "unavailable",
    total: null,
    active: null,
    due: null,
    withRecentSuccess: null,
    withRecentFailure: null,
    rows: []
  };
}

function unavailableIngestion(): AdminOperationsDrilldown["ingestion"] {
  return {
    status: "unavailable",
    recentEntryCount: null,
    recentBatchCount: null,
    latestEntryAt: null,
    rows: []
  };
}

function isHttpSuccess(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 200 && status < 400;
}

function isHttpFailure(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 400;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const first = parts[0];
  const second = parts[1];
  if (typeof first !== "number" || typeof second !== "number") return true;
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
}
