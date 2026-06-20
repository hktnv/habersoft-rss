import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { TenantAuthModule } from "../tenant-auth/tenant-auth.module";
import { ListTenantFeedsUseCase } from "./list-tenant-feeds.use-case";
import { SubscribeFeedUseCase } from "./subscribe-feed.use-case";
import { TenantFeedSubscriptionsRepository } from "./tenant-feed-subscriptions.repository";
import { TenantFeedsController } from "./tenant-feeds.controller";
import { UnsubscribeFeedUseCase } from "./unsubscribe-feed.use-case";

@Module({
  imports: [PersistenceModule, TenantAuthModule],
  controllers: [TenantFeedsController],
  providers: [
    TenantFeedSubscriptionsRepository,
    SubscribeFeedUseCase,
    ListTenantFeedsUseCase,
    UnsubscribeFeedUseCase
  ]
})
export class TenantFeedsModule {}
