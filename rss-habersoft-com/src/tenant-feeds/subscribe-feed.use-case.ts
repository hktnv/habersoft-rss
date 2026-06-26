import { Injectable } from "@nestjs/common";
import type { TenantPrincipal } from "../tenant-auth/tenant-auth.types";
import { TenantFeedSubscriptionsRepository } from "./tenant-feed-subscriptions.repository";
import type { SubscribeFeedResult } from "./tenant-feeds.types";

@Injectable()
export class SubscribeFeedUseCase {
  public constructor(private readonly subscriptions: TenantFeedSubscriptionsRepository) {}

  public async execute(principal: TenantPrincipal, url: string): Promise<SubscribeFeedResult> {
    return this.subscriptions.subscribe({
      siteClientId: principal.siteClientId,
      url
    });
  }
}
