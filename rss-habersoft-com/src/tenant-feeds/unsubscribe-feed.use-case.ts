import { Injectable } from "@nestjs/common";
import type { TenantPrincipal } from "../tenant-auth/tenant-auth.types";
import { TenantFeedSubscriptionsRepository } from "./tenant-feed-subscriptions.repository";
import type { UnsubscribeFeedResult } from "./tenant-feeds.types";

@Injectable()
export class UnsubscribeFeedUseCase {
  public constructor(private readonly subscriptions: TenantFeedSubscriptionsRepository) {}

  public async execute(principal: TenantPrincipal, feedId: bigint): Promise<UnsubscribeFeedResult> {
    return this.subscriptions.unsubscribe({
      siteClientId: principal.siteClientId,
      feedId
    });
  }
}
