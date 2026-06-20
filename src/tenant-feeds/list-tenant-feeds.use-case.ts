import { Injectable } from "@nestjs/common";
import type { TenantPrincipal } from "../tenant-auth/tenant-auth.types";
import { TenantFeedSubscriptionsRepository } from "./tenant-feed-subscriptions.repository";
import type { TenantFeedListItem } from "./tenant-feeds.types";

@Injectable()
export class ListTenantFeedsUseCase {
  public constructor(private readonly subscriptions: TenantFeedSubscriptionsRepository) {}

  public async execute(principal: TenantPrincipal): Promise<readonly TenantFeedListItem[]> {
    return this.subscriptions.list(principal.siteClientId);
  }
}
