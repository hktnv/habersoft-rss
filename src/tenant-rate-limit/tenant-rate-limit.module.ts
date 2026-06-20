import { Module } from "@nestjs/common";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { RedisTenantRateLimitStore } from "./redis-tenant-rate-limit.store";
import { TENANT_RATE_LIMIT_STORE } from "./tenant-rate-limit.store";
import { TenantRateLimitGuard } from "./tenant-rate-limit.guard";
import { TenantRateLimitService } from "./tenant-rate-limit.service";

@Module({
  imports: [RedisRuntimeModule],
  providers: [
    TenantRateLimitGuard,
    TenantRateLimitService,
    RedisTenantRateLimitStore,
    {
      provide: TENANT_RATE_LIMIT_STORE,
      useExisting: RedisTenantRateLimitStore
    }
  ],
  exports: [TenantRateLimitGuard, TenantRateLimitService]
})
export class TenantRateLimitModule {}
