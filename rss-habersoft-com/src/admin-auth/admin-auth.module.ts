import { Module } from "@nestjs/common";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginRateLimiter } from "./admin-login-rate-limiter.service";

@Module({
  imports: [RedisRuntimeModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminLoginRateLimiter],
  exports: [AdminAuthService]
})
export class AdminAuthModule {}

