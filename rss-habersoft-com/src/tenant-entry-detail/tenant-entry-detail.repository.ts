import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PostgresService } from "../persistence/postgres.service";
import { TenantEntryDetailInvariantError } from "./tenant-entry-detail.invariant-error";
import type { TenantEntryDetailInput, TenantEntryDetailItem } from "./tenant-entry-detail.types";

type TenantEntryDetailRow = {
  readonly entry_id: bigint;
  readonly has_detail: boolean;
  readonly detail: string | null;
  readonly images: unknown;
  readonly videos: unknown;
  readonly tags: unknown;
  readonly author: string | null;
  readonly meta: unknown;
  readonly detail_extraction_status: string;
  readonly detail_extraction_attempted_at: Date | null;
  readonly detail_extraction_finalized_at: Date;
  readonly detail_extraction_error_code: string | null;
};

const detailExtractionStatuses = new Set([
  "ok",
  "timeout",
  "playwright_failed",
  "blocked",
  "empty_content",
  "normalizer_rejected",
  "skipped_budget_exceeded"
]);

@Injectable()
export class TenantEntryDetailRepository {
  private readonly database: PrismaClient;

  public constructor(postgres: PostgresService) {
    this.database = postgres.database();
  }

  public async get(input: TenantEntryDetailInput): Promise<TenantEntryDetailItem | null> {
    const rows = await this.database.$queryRaw<TenantEntryDetailRow[]>`
      SELECT
        e.id AS entry_id,
        e.has_detail,
        ed.detail,
        e.images,
        e.videos,
        e.tags,
        e.author,
        e.meta,
        e.detail_extraction_status,
        e.detail_extraction_attempted_at,
        e.detail_extraction_finalized_at,
        e.detail_extraction_error_code
      FROM entries e
      INNER JOIN site_feeds sf
        ON sf.feed_id = e.feed_id
       AND sf.site_client_id = ${input.siteClientId}
      LEFT JOIN entry_details ed
        ON ed.entry_id = e.id
       AND ed.feed_id = e.feed_id
      WHERE e.id = ${input.entryId}
      LIMIT 2
    `;

    if (rows.length === 0) {
      return null;
    }

    if (rows.length > 1) {
      throw new TenantEntryDetailInvariantError("entry_detail_visibility_not_unique");
    }

    return toDetailItem(rows[0]);
  }
}

function toDetailItem(row: TenantEntryDetailRow | undefined): TenantEntryDetailItem {
  if (row === undefined) {
    throw new TenantEntryDetailInvariantError("entry_detail_row_missing");
  }

  if (!detailExtractionStatuses.has(row.detail_extraction_status)) {
    throw new TenantEntryDetailInvariantError("entry_detail_unknown_status");
  }

  if (row.detail_extraction_status === "ok" && row.detail_extraction_error_code !== null) {
    throw new TenantEntryDetailInvariantError("entry_detail_ok_error_code_mismatch");
  }

  if (row.detail_extraction_status === "skipped_budget_exceeded" && row.detail_extraction_attempted_at !== null) {
    throw new TenantEntryDetailInvariantError("entry_detail_skipped_attempted_mismatch");
  }

  if (row.detail_extraction_status !== "skipped_budget_exceeded" && row.detail_extraction_attempted_at === null) {
    throw new TenantEntryDetailInvariantError("entry_detail_attempted_missing");
  }

  return {
    entryId: row.entry_id,
    hasDetail: row.has_detail,
    detail: row.detail,
    images: toStringArray(row.images, "images"),
    videos: toStringArray(row.videos, "videos"),
    tags: toStringArray(row.tags, "tags"),
    author: row.author,
    meta: toMetaObject(row.meta),
    detailExtraction: {
      status: row.detail_extraction_status,
      attemptedAt: row.detail_extraction_attempted_at,
      finalizedAt: row.detail_extraction_finalized_at,
      errorCode: row.detail_extraction_error_code
    }
  };
}

function toStringArray(value: unknown, field: string): readonly string[] {
  if (value === null) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TenantEntryDetailInvariantError(`entry_detail_invalid_${field}`);
  }

  return value;
}

function toMetaObject(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new TenantEntryDetailInvariantError("entry_detail_invalid_meta");
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
