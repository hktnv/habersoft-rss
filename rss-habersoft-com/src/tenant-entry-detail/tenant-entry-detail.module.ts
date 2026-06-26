import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { TenantAuthModule } from "../tenant-auth/tenant-auth.module";
import { TenantRateLimitModule } from "../tenant-rate-limit/tenant-rate-limit.module";
import { GetTenantEntryDetailUseCase } from "./get-tenant-entry-detail.use-case";
import { TenantEntryDetailController } from "./tenant-entry-detail.controller";
import { TenantEntryDetailRepository } from "./tenant-entry-detail.repository";

@Module({
  imports: [PersistenceModule, TenantAuthModule, TenantRateLimitModule],
  controllers: [TenantEntryDetailController],
  providers: [TenantEntryDetailRepository, GetTenantEntryDetailUseCase]
})
export class TenantEntryDetailModule {}
