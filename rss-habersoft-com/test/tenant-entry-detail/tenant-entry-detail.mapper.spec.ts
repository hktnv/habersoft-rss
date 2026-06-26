import { TenantEntryDetailInvariantError } from "../../src/tenant-entry-detail/tenant-entry-detail.invariant-error";
import { toTenantEntryDetailResponse } from "../../src/tenant-entry-detail/tenant-entry-detail.mapper";
import type { TenantEntryDetailItem } from "../../src/tenant-entry-detail/tenant-entry-detail.types";

describe("tenant entry detail mapper", () => {
  it("maps bigint and extraction dates to the public response", () => {
    expect(toTenantEntryDetailResponse(detailItem())).toEqual({
      entry_id: "10",
      has_detail: true,
      detail: "<p>Detail</p>",
      images: ["https://cdn.example.test/a.jpg"],
      videos: ["https://cdn.example.test/a.mp4"],
      tags: ["tag-a"],
      author: "Author",
      meta: { "og:site_name": "Example" },
      detail_extraction: {
        status: "ok",
        attempted_at: "2026-06-20T10:00:01.000Z",
        finalized_at: "2026-06-20T10:00:02.000Z",
        error_code: null
      }
    });
  });

  it("keeps visible retained entries as detail null", () => {
    expect(
      toTenantEntryDetailResponse(
        detailItem({
          hasDetail: false,
          detail: null,
          detailExtraction: {
            status: "ok",
            attemptedAt: new Date("2026-06-20T10:00:01.000Z"),
            finalizedAt: new Date("2026-06-20T10:00:02.000Z"),
            errorCode: null
          }
        })
      )
    ).toMatchObject({ has_detail: false, detail: null });
  });

  it("does not silently mask has_detail/detail mismatches", () => {
    expect(() => toTenantEntryDetailResponse(detailItem({ hasDetail: true, detail: null }))).toThrow(
      TenantEntryDetailInvariantError
    );
    expect(() => toTenantEntryDetailResponse(detailItem({ hasDetail: false, detail: "<p>stale</p>" }))).toThrow(
      TenantEntryDetailInvariantError
    );
  });
});

function detailItem(overrides: Partial<TenantEntryDetailItem> = {}): TenantEntryDetailItem {
  return {
    entryId: 10n,
    hasDetail: true,
    detail: "<p>Detail</p>",
    images: ["https://cdn.example.test/a.jpg"],
    videos: ["https://cdn.example.test/a.mp4"],
    tags: ["tag-a"],
    author: "Author",
    meta: { "og:site_name": "Example" },
    detailExtraction: {
      status: "ok",
      attemptedAt: new Date("2026-06-20T10:00:01.000Z"),
      finalizedAt: new Date("2026-06-20T10:00:02.000Z"),
      errorCode: null
    },
    ...overrides
  };
}
