import { DynamicModule, Module } from "@nestjs/common";
import { RuntimeConfig } from "./configuration/runtime-config";
import { RuntimeConfigModule } from "./configuration/runtime-config.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";

@Module({})
export class WorkerModule {
  public static register(config: RuntimeConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [RuntimeConfigModule.register(config), MaintenanceModule]
    };
  }
}
