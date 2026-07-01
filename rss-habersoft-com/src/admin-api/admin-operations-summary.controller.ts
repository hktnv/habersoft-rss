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
import { AdminOperationsDrilldownService } from "./admin-operations-drilldown.service";
import type { AdminOperationsDrilldown } from "./admin-operations-drilldown.types";
import { AdminOperationsSummaryService } from "./admin-operations-summary.service";
import type { AdminOperationsSummary } from "./admin-operations-summary.types";

@Controller("admin-api/operations")
export class AdminOperationsSummaryController {
  public constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly summary: AdminOperationsSummaryService,
    private readonly drilldown: AdminOperationsDrilldownService
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

  @Get("drilldown")
  public async readDrilldown(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminOperationsDrilldown | { readonly configured: false; readonly authenticated: false; readonly reason: "not_configured"; readonly message: string }> {
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

    return this.drilldown.readDrilldown();
  }

  @Post("summary")
  @HttpCode(405)
  public rejectSummaryPost(): never {
    return methodNotAllowed();
  }

  @Put("summary")
  @HttpCode(405)
  public rejectSummaryPut(): never {
    return methodNotAllowed();
  }

  @Patch("summary")
  @HttpCode(405)
  public rejectSummaryPatch(): never {
    return methodNotAllowed();
  }

  @Delete("summary")
  @HttpCode(405)
  public rejectSummaryDelete(): never {
    return methodNotAllowed();
  }

  @Post("drilldown")
  @HttpCode(405)
  public rejectDrilldownPost(): never {
    return methodNotAllowed();
  }

  @Put("drilldown")
  @HttpCode(405)
  public rejectDrilldownPut(): never {
    return methodNotAllowed();
  }

  @Patch("drilldown")
  @HttpCode(405)
  public rejectDrilldownPatch(): never {
    return methodNotAllowed();
  }

  @Delete("drilldown")
  @HttpCode(405)
  public rejectDrilldownDelete(): never {
    return methodNotAllowed();
  }
}

function methodNotAllowed(): never {
    throw new MethodNotAllowedException({
      status: "method_not_allowed",
      reason: "read_only_endpoint"
    });
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate");
}
