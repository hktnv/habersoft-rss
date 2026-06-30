import {
  Controller,
  Get,
  HttpCode,
  MethodNotAllowedException,
  Post,
  Put,
  Patch,
  Delete,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthService } from "../admin-auth/admin-auth.service";
import { AdminOperationsSummaryService } from "./admin-operations-summary.service";
import type { AdminOperationsSummary } from "./admin-operations-summary.types";

@Controller("admin-api/operations")
export class AdminOperationsSummaryController {
  public constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly summary: AdminOperationsSummaryService
  ) {}

  @Get("summary")
  public async readSummary(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminOperationsSummary | { readonly configured: false; readonly authenticated: false; readonly reason: "not_configured"; readonly message: string }> {
    noStore(reply);
    const session = await this.adminAuth.session(request);

    if (!session.configured) {
      reply.status(501);
      return {
        configured: false,
        authenticated: false,
        reason: "not_configured",
        message: "Admin authentication is not configured."
      };
    }

    if (!session.authenticated) {
      throw new UnauthorizedException({
        authenticated: false,
        reason: "unauthenticated"
      });
    }

    return this.summary.readSummary();
  }

  @Post("summary")
  @Put("summary")
  @Patch("summary")
  @Delete("summary")
  @HttpCode(405)
  public methodNotAllowed(): never {
    throw new MethodNotAllowedException({
      status: "method_not_allowed",
      reason: "read_only_endpoint"
    });
  }
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
}
