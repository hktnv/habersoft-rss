import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TENANT_PRINCIPAL_REQUEST_KEY } from "../tenant-auth/tenant-auth.constants";
import type { TenantAuthenticatedRequest, TenantPrincipal } from "../tenant-auth/tenant-auth.types";
import { TenantJwtAuthGuard } from "../tenant-auth/tenant-jwt-auth.guard";
import { TenantRateLimitGuard } from "../tenant-rate-limit/tenant-rate-limit.guard";
import { ListTenantFeedsUseCase } from "./list-tenant-feeds.use-case";
import { SubscribeFeedUseCase } from "./subscribe-feed.use-case";
import {
  validateFeedId,
  validateNoQueryParameters,
  validateSubscribeFeedRequest
} from "./tenant-feeds.request-validation";
import type { TenantFeedListItem } from "./tenant-feeds.types";
import { UnsubscribeFeedUseCase } from "./unsubscribe-feed.use-case";

type TenantFeedRequest = FastifyRequest & TenantAuthenticatedRequest;

type SubscribeFeedResponse =
  | {
      readonly feed_id: string;
      readonly url: string;
      readonly subscribed: true;
      readonly created_feed: boolean;
    }
  | {
      readonly feed_id: string;
      readonly url: string;
      readonly subscribed: true;
      readonly already_subscribed: true;
    };

type ListFeedResponse = {
  readonly feed_id: string;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscribed_at: string;
};

@Controller("api/feeds")
@UseGuards(TenantJwtAuthGuard, TenantRateLimitGuard)
export class TenantFeedsController {
  public constructor(
    private readonly subscribeFeed: SubscribeFeedUseCase,
    private readonly listTenantFeeds: ListTenantFeedsUseCase,
    private readonly unsubscribeFeed: UnsubscribeFeedUseCase
  ) {}

  @Post()
  public async subscribe(
    @Req() request: TenantFeedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SubscribeFeedResponse> {
    const validated = validateSubscribeFeedRequest(body);
    if (!validated.ok) {
      throw validationError();
    }

    const result = await this.subscribeFeed.execute(requirePrincipal(request), validated.value.url);
    if (result.outcome === "feed_admin_disabled") {
      throw new ConflictException({ error_code: "FEED_ADMIN_DISABLED" });
    }

    if (result.outcome === "already_subscribed") {
      reply.status(200);
      return {
        feed_id: result.feedId.toString(),
        url: result.url,
        subscribed: true,
        already_subscribed: true
      };
    }

    reply.status(201);
    return {
      feed_id: result.feedId.toString(),
      url: result.url,
      subscribed: true,
      created_feed: result.outcome === "created_feed"
    };
  }

  @Get()
  public async list(@Req() request: TenantFeedRequest, @Query() query: unknown): Promise<readonly ListFeedResponse[]> {
    const validated = validateNoQueryParameters(query);
    if (!validated.ok) {
      throw validationError();
    }

    const rows = await this.listTenantFeeds.execute(requirePrincipal(request));
    return rows.map(toListResponse);
  }

  @Delete(":feed_id")
  @HttpCode(204)
  public async unsubscribe(
    @Req() request: TenantFeedRequest,
    @Param("feed_id") feedIdParam: string,
    @Query() query: unknown
  ): Promise<void> {
    const validatedQuery = validateNoQueryParameters(query);
    const validatedFeedId = validateFeedId(feedIdParam);
    if (!validatedQuery.ok || !validatedFeedId.ok) {
      throw validationError();
    }

    await this.unsubscribeFeed.execute(requirePrincipal(request), validatedFeedId.value);
  }
}

function requirePrincipal(request: TenantFeedRequest): TenantPrincipal {
  const principal = request[TENANT_PRINCIPAL_REQUEST_KEY];
  if (principal === undefined) {
    throw new InternalServerErrorException();
  }

  return principal;
}

function validationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({ error_code: "VALIDATION_FAILED" });
}

function toListResponse(row: TenantFeedListItem): ListFeedResponse {
  return {
    feed_id: row.feedId.toString(),
    url: row.url,
    title: row.title,
    active: row.active,
    subscribed_at: row.subscribedAt.toISOString()
  };
}
