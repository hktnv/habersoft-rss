import {
  Body,
  Controller,
  Get,
  HttpCode,
  MethodNotAllowedException,
  Post,
  Put,
  Patch,
  Delete,
  ForbiddenException,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthService } from "../admin-auth/admin-auth.service";
import { AdminFeedRecheckService } from "./admin-feed-recheck.service";
import type { AdminFeedRecheckResponse } from "./admin-feed-recheck.types";
import { AdminOperationsDrilldownService } from "./admin-operations-drilldown.service";
import type { AdminOperationsDrilldown } from "./admin-operations-drilldown.types";
import { AdminOperationsSummaryService } from "./admin-operations-summary.service";
import type { AdminOperationsSummary } from "./admin-operations-summary.types";

@Controller("admin-api/operations")
export class AdminOperationsSummaryController {
  public constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly summary: AdminOperationsSummaryService,
    private readonly drilldown: AdminOperationsDrilldownService,
    private readonly feedRecheck: AdminFeedRecheckService
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

  @Post("feed-recheck-requests")
  public async requestFeedRecheck(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<AdminFeedRecheckResponse | { readonly configured: false; readonly authenticated: false; readonly reason: "not_configured"; readonly message: string }> {
    noStore(reply);
    const session = await this.adminAuth.authenticatedSession(request);

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

    if (!isJsonRequest(request) || hasQueryString(request)) {
      reply.status(400);
      return {
        status: "unavailable",
        requestId: null,
        target: null,
        queued: false,
        cooldownSeconds: null,
        message: "Feed recheck request was not accepted.",
        generatedAt: new Date().toISOString()
      };
    }

    const csrf = singleHeader(request.headers["x-admin-csrf"]);
    if (!this.adminAuth.isValidCsrfToken(session.session, csrf)) {
      throw new ForbiddenException({
        authenticated: true,
        reason: "csrf_failed"
      });
    }

    const result = await this.feedRecheck.requestFeedRecheck({
      body,
      idempotencyKey: singleHeader(request.headers["x-admin-idempotency-key"]) ?? "",
      sessionKey: session.session.sessionKey
    });
    reply.status(result.httpStatus);
    return result.body;
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

  @Get("feed-recheck-requests")
  @HttpCode(405)
  public rejectFeedRecheckGet(): never {
    return actionMethodNotAllowed();
  }

  @Put("feed-recheck-requests")
  @HttpCode(405)
  public rejectFeedRecheckPut(): never {
    return actionMethodNotAllowed();
  }

  @Patch("feed-recheck-requests")
  @HttpCode(405)
  public rejectFeedRecheckPatch(): never {
    return actionMethodNotAllowed();
  }

  @Delete("feed-recheck-requests")
  @HttpCode(405)
  public rejectFeedRecheckDelete(): never {
    return actionMethodNotAllowed();
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

function actionMethodNotAllowed(): never {
  throw new MethodNotAllowedException({
    status: "method_not_allowed",
    reason: "feed_recheck_requires_post"
  });
}

function isJsonRequest(request: FastifyRequest): boolean {
  const contentType = singleHeader(request.headers["content-type"])?.toLowerCase() ?? "";
  return contentType.split(";", 1)[0]?.trim() === "application/json";
}

function hasQueryString(request: FastifyRequest): boolean {
  const queryStart = request.url.indexOf("?");
  return queryStart >= 0 && queryStart < request.url.length - 1;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
