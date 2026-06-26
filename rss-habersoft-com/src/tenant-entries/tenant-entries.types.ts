export type TenantEntryListInput = {
  readonly siteClientId: string;
  readonly offset: number;
  readonly limit: number;
};

export type TenantEntryListItem = {
  readonly id: bigint;
  readonly guid: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly effectiveAt: Date;
  readonly summary: string | null;
  readonly feedUrl: string;
  readonly hasDetail: boolean;
  readonly primaryImage: string | null;
  readonly tags: readonly string[] | null;
  readonly author: string | null;
};
