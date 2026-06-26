export type SubscribeFeedInput = {
  readonly siteClientId: string;
  readonly url: string;
};

export type SubscribeFeedResult =
  | {
      readonly outcome: "created_feed" | "subscribed_existing_feed" | "already_subscribed";
      readonly feedId: bigint;
      readonly url: string;
    }
  | {
      readonly outcome: "feed_admin_disabled";
      readonly feedId: bigint;
      readonly url: string;
    };

export type TenantFeedListItem = {
  readonly feedId: bigint;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscribedAt: Date;
};

export type UnsubscribeFeedInput = {
  readonly siteClientId: string;
  readonly feedId: bigint;
};

export type UnsubscribeFeedResult = {
  readonly outcome: "unsubscribed" | "already_absent";
};
