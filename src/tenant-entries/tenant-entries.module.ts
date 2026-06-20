import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { TenantAuthModule } from "../tenant-auth/tenant-auth.module";
import { TenantRateLimitModule } from "../tenant-rate-limit/tenant-rate-limit.module";
import { ListTenantEntriesUseCase } from "./list-tenant-entries.use-case";
import { TenantEntriesController } from "./tenant-entries.controller";
import { TenantEntryListRepository } from "./tenant-entry-list.repository";

@Module({
  imports: [PersistenceModule, TenantAuthModule, TenantRateLimitModule],
  controllers: [TenantEntriesController],
  providers: [TenantEntryListRepository, ListTenantEntriesUseCase]
})
export class TenantEntriesModule {}
