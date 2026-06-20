import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { TenantAuthModule } from "../tenant-auth/tenant-auth.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [PersistenceModule, RedisRuntimeModule, TenantAuthModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService]
})
export class HealthModule {}
