import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { HealthModule } from "../health/health.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { AdminFeedRecheckService } from "./admin-feed-recheck.service";
import { AdminOperationsDrilldownService } from "./admin-operations-drilldown.service";
import { AdminOperationsSummaryController } from "./admin-operations-summary.controller";
import { AdminOperationsSummaryService } from "./admin-operations-summary.service";

@Module({
  imports: [AdminAuthModule, HealthModule, PersistenceModule, RedisRuntimeModule],
  controllers: [AdminOperationsSummaryController],
  providers: [AdminOperationsSummaryService, AdminOperationsDrilldownService, AdminFeedRecheckService]
})
export class AdminApiModule {}
