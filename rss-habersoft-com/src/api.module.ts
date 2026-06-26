import { DynamicModule, Module } from "@nestjs/common";
import { AgentAuthModule } from "./agent-auth/agent-auth.module";
import { AgentDueFeedsModule } from "./agent-due-feeds/agent-due-feeds.module";
import { AgentEntriesModule } from "./agent-entries/agent-entries.module";
import { AgentFeedCheckResultsModule } from "./agent-feed-check-results/agent-feed-check-results.module";
import { AgentHeartbeatModule } from "./agent-heartbeat/agent-heartbeat.module";
import { AgentNewGuidsModule } from "./agent-new-guids/agent-new-guids.module";
import { RuntimeConfig } from "./configuration/runtime-config";
import { RuntimeConfigModule } from "./configuration/runtime-config.module";
import { HealthModule } from "./health/health.module";
import { TenantAuthModule } from "./tenant-auth/tenant-auth.module";
import { TenantEntryDetailModule } from "./tenant-entry-detail/tenant-entry-detail.module";
import { TenantEntriesModule } from "./tenant-entries/tenant-entries.module";
import { TenantFeedsModule } from "./tenant-feeds/tenant-feeds.module";

@Module({})
export class ApiModule {
  public static register(config: RuntimeConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        RuntimeConfigModule.register(config),
        AgentAuthModule,
        AgentHeartbeatModule,
        AgentDueFeedsModule,
        AgentEntriesModule,
        AgentFeedCheckResultsModule,
        AgentNewGuidsModule,
        TenantAuthModule,
        HealthModule,
        TenantFeedsModule,
        TenantEntriesModule,
        TenantEntryDetailModule
      ]
    };
  }
}
