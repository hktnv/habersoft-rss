import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AuthorizationHeaderParser } from "./authorization-header.parser";
import { TENANT_PRINCIPAL_REQUEST_KEY } from "./tenant-auth.constants";
import { TenantAuthenticatedRequest } from "./tenant-auth.types";
import { TenantJwtVerifier } from "./tenant-jwt.verifier";

type AuthenticatedFastifyRequest = FastifyRequest & TenantAuthenticatedRequest;

@Injectable()
export class TenantJwtAuthGuard implements CanActivate {
  public constructor(
    private readonly parser: AuthorizationHeaderParser,
    private readonly verifier: TenantJwtVerifier
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    const parsed = this.parser.parse(request.headers.authorization);

    if (!parsed.ok) {
      throw new UnauthorizedException();
    }

    const result = await this.verifier.verify(parsed.token);
    if (!result.ok) {
      if (result.outcome === "forbidden") {
        throw new ForbiddenException();
      }

      if (result.outcome === "unavailable") {
        throw new ServiceUnavailableException();
      }

      throw new UnauthorizedException();
    }

    request[TENANT_PRINCIPAL_REQUEST_KEY] = result.principal;
    return true;
  }
}
