import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TENANT_PRINCIPAL_REQUEST_KEY } from "../tenant-auth/tenant-auth.constants";
import type { TenantAuthenticatedRequest } from "../tenant-auth/tenant-auth.types";
import { TenantRateLimitService } from "./tenant-rate-limit.service";

type TenantRateLimitedRequest = FastifyRequest & TenantAuthenticatedRequest;

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  public constructor(private readonly rateLimit: TenantRateLimitService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<TenantRateLimitedRequest>();
    const principal = request[TENANT_PRINCIPAL_REQUEST_KEY];

    if (principal === undefined) {
      throw new InternalServerErrorException();
    }

    const result = await this.rateLimit.consume(principal.siteClientId);
    if (result.outcome === "allowed") {
      return true;
    }

    if (result.outcome === "limited") {
      const reply = http.getResponse<FastifyReply>();
      reply.header("Retry-After", result.retryAfterSeconds.toString());
      throw new HttpException("Too Many Requests", HttpStatus.TOO_MANY_REQUESTS);
    }

    throw new ServiceUnavailableException();
  }
}
