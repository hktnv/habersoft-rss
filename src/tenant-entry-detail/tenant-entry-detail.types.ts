export type TenantEntryDetailInput = {
  readonly siteClientId: string;
  readonly entryId: bigint;
};

export type TenantEntryDetailExtraction = {
  readonly status: string;
  readonly attemptedAt: Date | null;
  readonly finalizedAt: Date;
  readonly errorCode: string | null;
};

export type TenantEntryDetailItem = {
  readonly entryId: bigint;
  readonly hasDetail: boolean;
  readonly detail: string | null;
  readonly images: readonly string[];
  readonly videos: readonly string[];
  readonly tags: readonly string[];
  readonly author: string | null;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly detailExtraction: TenantEntryDetailExtraction;
};
