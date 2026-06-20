import { TenantEntryDetailInvariantError } from "./tenant-entry-detail.invariant-error";
import type { TenantEntryDetailItem } from "./tenant-entry-detail.types";

export type TenantEntryDetailResponse = {
  readonly entry_id: string;
  readonly has_detail: boolean;
  readonly detail: string | null;
  readonly images: readonly string[];
  readonly videos: readonly string[];
  readonly tags: readonly string[];
  readonly author: string | null;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly detail_extraction: {
    readonly status: string;
    readonly attempted_at: string | null;
    readonly finalized_at: string;
    readonly error_code: string | null;
  };
};

export function toTenantEntryDetailResponse(item: TenantEntryDetailItem): TenantEntryDetailResponse {
  assertDetailState(item);

  return {
    entry_id: item.entryId.toString(),
    has_detail: item.hasDetail,
    detail: item.detail,
    images: item.images,
    videos: item.videos,
    tags: item.tags,
    author: item.author,
    meta: item.meta,
    detail_extraction: {
      status: item.detailExtraction.status,
      attempted_at: item.detailExtraction.attemptedAt?.toISOString() ?? null,
      finalized_at: item.detailExtraction.finalizedAt.toISOString(),
      error_code: item.detailExtraction.errorCode
    }
  };
}

export function assertDetailState(item: TenantEntryDetailItem): void {
  const hasDetailRow = item.detail !== null;

  if (item.hasDetail !== hasDetailRow) {
    throw new TenantEntryDetailInvariantError("entry_detail_flag_mismatch");
  }

  if (hasDetailRow && item.detailExtraction.status !== "ok") {
    throw new TenantEntryDetailInvariantError("entry_detail_status_mismatch");
  }

  if (item.hasDetail && item.detailExtraction.status !== "ok") {
    throw new TenantEntryDetailInvariantError("entry_has_detail_status_mismatch");
  }
}
