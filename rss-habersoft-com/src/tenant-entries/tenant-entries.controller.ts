import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { TENANT_PRINCIPAL_REQUEST_KEY } from "../tenant-auth/tenant-auth.constants";
import type { TenantAuthenticatedRequest, TenantPrincipal } from "../tenant-auth/tenant-auth.types";
import { TenantJwtAuthGuard } from "../tenant-auth/tenant-jwt-auth.guard";
import { TenantRateLimitGuard } from "../tenant-rate-limit/tenant-rate-limit.guard";
import { ListTenantEntriesUseCase } from "./list-tenant-entries.use-case";
import { toTenantEntryListResponse, type TenantEntryListResponseItem } from "./tenant-entries.mapper";
import { validateTenantEntriesQuery } from "./tenant-entries.query-validation";

type TenantEntryRequest = FastifyRequest & TenantAuthenticatedRequest;

@Controller("api/entries")
@UseGuards(TenantJwtAuthGuard, TenantRateLimitGuard)
export class TenantEntriesController {
  public constructor(private readonly listTenantEntries: ListTenantEntriesUseCase) {}

  @Get()
  public async list(
    @Req() request: TenantEntryRequest,
    @Query() query: unknown
  ): Promise<readonly TenantEntryListResponseItem[]> {
    const validated = validateTenantEntriesQuery(query);
    if (!validated.ok) {
      throw new UnprocessableEntityException({ error_code: "VALIDATION_FAILED" });
    }

    const principal = requirePrincipal(request);
    const rows = await this.listTenantEntries.execute({
      siteClientId: principal.siteClientId,
      offset: validated.value.offset,
      limit: validated.value.limit
    });

    return rows.map(toTenantEntryListResponse);
  }
}

function requirePrincipal(request: TenantEntryRequest): TenantPrincipal {
  const principal = request[TENANT_PRINCIPAL_REQUEST_KEY];
  if (principal === undefined) {
    throw new InternalServerErrorException();
  }

  return principal;
}
