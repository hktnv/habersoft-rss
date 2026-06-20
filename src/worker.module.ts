import { DynamicModule, Module } from "@nestjs/common";
import { RuntimeConfig } from "./configuration/runtime-config";
import { RuntimeConfigModule } from "./configuration/runtime-config.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { RedisRuntimeModule } from "./redis/redis-runtime.module";
import { WorkerBootstrapService } from "./worker/worker-bootstrap.service";

@Module({})
export class WorkerModule {
  public static register(config: RuntimeConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [RuntimeConfigModule.register(config), PersistenceModule, RedisRuntimeModule],
      providers: [WorkerBootstrapService]
    };
  }
}
