import { Module } from "@nestjs/common";
import { AuthorizationHeaderParser } from "./authorization-header.parser";
import { JwksCacheService, TIMER_SCHEDULER } from "./jwks-cache.service";
import { JwksHttpClient } from "./jwks-http.client";
import { NodeTimerScheduler } from "./timer-scheduler";
import { TENANT_AUTH_READINESS } from "./tenant-auth.constants";
import { TenantJwtAuthGuard } from "./tenant-jwt-auth.guard";
import { TenantJwtVerifier } from "./tenant-jwt.verifier";

@Module({
  providers: [
    AuthorizationHeaderParser,
    JwksHttpClient,
    JwksCacheService,
    TenantJwtVerifier,
    TenantJwtAuthGuard,
    {
      provide: TIMER_SCHEDULER,
      useClass: NodeTimerScheduler
    },
    {
      provide: TENANT_AUTH_READINESS,
      useExisting: JwksCacheService
    }
  ],
  exports: [AuthorizationHeaderParser, TenantJwtVerifier, TenantJwtAuthGuard, TENANT_AUTH_READINESS]
})
export class TenantAuthModule {}
