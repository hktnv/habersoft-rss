import { DynamicModule, Module } from "@nestjs/common";
import { AgentAuthModule } from "./agent-auth/agent-auth.module";
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
        TenantAuthModule,
        HealthModule,
        TenantFeedsModule,
        TenantEntriesModule,
        TenantEntryDetailModule
      ]
    };
  }
}
