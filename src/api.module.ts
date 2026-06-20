import { DynamicModule, Module } from "@nestjs/common";
import { RuntimeConfig } from "./configuration/runtime-config";
import { RuntimeConfigModule } from "./configuration/runtime-config.module";
import { HealthModule } from "./health/health.module";

@Module({})
export class ApiModule {
  public static register(config: RuntimeConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [RuntimeConfigModule.register(config), HealthModule]
    };
  }
}
