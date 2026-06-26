import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
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
import { GetTenantEntryDetailUseCase } from "./get-tenant-entry-detail.use-case";
import { TenantEntryDetailInvariantError } from "./tenant-entry-detail.invariant-error";
import { toTenantEntryDetailResponse, type TenantEntryDetailResponse } from "./tenant-entry-detail.mapper";
import { validateNoDetailQueryParameters, validateTenantEntryId } from "./tenant-entry-detail.validation";

type TenantEntryDetailRequest = FastifyRequest & TenantAuthenticatedRequest;

@Controller("api/entries")
@UseGuards(TenantJwtAuthGuard, TenantRateLimitGuard)
export class TenantEntryDetailController {
  public constructor(private readonly getTenantEntryDetail: GetTenantEntryDetailUseCase) {}

  @Get(":id/detail")
  public async getDetail(
    @Req() request: TenantEntryDetailRequest,
    @Param("id") id: unknown,
    @Query() query: unknown
  ): Promise<TenantEntryDetailResponse> {
    const validatedId = validateTenantEntryId(id);
    const validatedQuery = validateNoDetailQueryParameters(query);
    if (!validatedId.ok || !validatedQuery.ok) {
      throw new UnprocessableEntityException({ error_code: "VALIDATION_FAILED" });
    }

    const principal = requirePrincipal(request);

    try {
      const item = await this.getTenantEntryDetail.execute({
        siteClientId: principal.siteClientId,
        entryId: validatedId.value
      });

      if (item === null) {
        throw new NotFoundException();
      }

      return toTenantEntryDetailResponse(item);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof TenantEntryDetailInvariantError) {
        throw new InternalServerErrorException();
      }

      throw error;
    }
  }
}

function requirePrincipal(request: TenantEntryDetailRequest): TenantPrincipal {
  const principal = request[TENANT_PRINCIPAL_REQUEST_KEY];
  if (principal === undefined) {
    throw new InternalServerErrorException();
  }

  return principal;
}
