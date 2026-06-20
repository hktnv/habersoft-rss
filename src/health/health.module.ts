import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [PersistenceModule, RedisRuntimeModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService]
})
export class HealthModule {}
