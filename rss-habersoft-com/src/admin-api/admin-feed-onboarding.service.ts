import { createHash, createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { RuntimeConfig, type AdminAuthConfig } from "../configuration/runtime-config";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { PostgresService } from "../persistence/postgres.service";
import { RedisService } from "../redis/redis.service";
import { ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID } from "../tenant-feeds/reserved-site-client-ids";
import type { AdminFeedOnboardingResponse } from "./admin-feed-onboarding.types";

export const ADMIN_FEED_ONBOARDING_BODY_LIMIT_BYTES = 4096;

type RequestFeedOnboardingInput = {
  readonly body: unknown;
  readonly idempotencyKey: string;
  readonly sessionKey: string;
  readonly now?: Date;
};

type RequestFeedOnboardingResult = {
  readonly httpStatus: number;
  readonly body: AdminFeedOnboardingResponse;
};

type FeedProjection = {
  readonly id: bigint;
  readonly url: string;
  readonly title: string | null;
  readonly active: boolean | null;
  readonly subscriberCount: number;
  readonly nextCheckAt: Date | null;
};

type ParsedFeedOnboardingRequest = {
  readonly canonicalUrl: string;
  readonly sourceHost: string;
  readonly label: string | null;
};

type FeedOnboardingTransaction = Pick<PrismaClient, "feed" | "siteFeed">;

const idempotencyTtlSeconds = 300;
const cooldownSeconds = 300;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{16,80}$/u;
const unsafeTextPattern = /(?:secret|password|token|cookie|authorization|bearer|database_url|redis_url)\s*[:=]/iu;

@Injectable()
export class AdminFeedOnboardingService {
  private readonly database: PrismaClient;
  private readonly adminAuthConfig: AdminAuthConfig | undefined;

  public constructor(
    @Inject(PostgresService)
    postgres: Pick<PostgresService, "database">,
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: RuntimeConfig,
    private readonly redis: RedisService
  ) {
    this.database = postgres.database();
    this.adminAuthConfig = runtimeConfig.adminAuth;
  }

  public async requestFeedOnboarding(input: RequestFeedOnboardingInput): Promise<RequestFeedOnboardingResult> {
    const now = input.now ?? new Date();
    const generatedAt = now.toISOString();
    const config = this.adminAuthConfig;

    if (config?.mode !== "single_admin") {
      return {
        httpStatus: 501,
        body: unavailableResponse(generatedAt, "Admin authentication is not configured.")
      };
    }

    const parsedBody = parseRequestBody(input.body);
    if (parsedBody === undefined) {
      return {
        httpStatus: 422,
        body: unavailableResponse(generatedAt, "Feed onboarding request body was not accepted.")
      };
    }

    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      return {
        httpStatus: 400,
        body: unavailableResponse(generatedAt, "Feed onboarding idempotency key was not accepted.")
      };
    }

    const requestDigest = safeDigest(config, `${parsedBody.canonicalUrl}\n${parsedBody.label ?? ""}`);
    const idempotencyKey = redisKey(config, "feed_onboarding:idempotency", input.sessionKey, input.idempotencyKey);
    const existing = await this.redis.command().call("GET", idempotencyKey);
    if (typeof existing === "string") {
      const replay = parseIdempotencyRecord(existing);
      if (replay?.requestDigest === requestDigest) {
        return {
          httpStatus: 200,
          body: {
            ...replay.body,
            generatedAt
          }
        };
      }

      return {
        httpStatus: 409,
        body: rateLimitedResponse(generatedAt, "This idempotency key has already been used for another feed onboarding request.")
      };
    }

    const cooldownKey = redisKey(config, "feed_onboarding:cooldown", "host", parsedBody.sourceHost);
    const ttl = await this.redis.command().call("TTL", cooldownKey);
    if (typeof ttl === "number" && ttl > 0) {
      return {
        httpStatus: 429,
        body: rateLimitedResponse(generatedAt, "Feed onboarding recently accepted a request for this source host; wait before trying again.")
      };
    }

    const requestRef = `onboard_${randomBytes(12).toString("base64url")}`;
    const result = await this.onboardFeed(parsedBody, requestRef, now, generatedAt);

    if (result.httpStatus === 201 || result.httpStatus === 200) {
      await this.redis.command().call(
        "SET",
        idempotencyKey,
        JSON.stringify({ requestDigest, body: result.body }),
        "EX",
        idempotencyTtlSeconds
      );
      if (result.body.status === "created") {
        await this.redis.command().call("SET", cooldownKey, requestRef, "EX", cooldownSeconds);
      }
    }

    return result;
  }

  private async onboardFeed(
    request: ParsedFeedOnboardingRequest,
    requestRef: string,
    now: Date,
    generatedAt: string
  ): Promise<RequestFeedOnboardingResult> {
    return this.database.$transaction(async (transaction: FeedOnboardingTransaction): Promise<RequestFeedOnboardingResult> => {
      const existing = await transaction.feed.findUnique({
        where: { url: request.canonicalUrl },
        select: feedSelect
      });

      const feed =
        existing ??
        (await transaction.feed.create({
          data: {
            url: request.canonicalUrl,
            title: request.label,
            active: true,
            subscriberCount: 0,
            nextCheckAt: now,
            createdAt: now
          },
          select: feedSelect
        }));

      if (feed.active !== true) {
        return {
          httpStatus: 409,
          body: {
            status: "unavailable",
            requestRef: null,
            feed: responseFeed(feed, request.sourceHost),
            nextSteps: ["Existing feed is disabled; resolve feed state before onboarding."],
            message: "Existing feed is disabled and was not changed by admin onboarding.",
            generatedAt
          }
        };
      }

      const existingOnboarding = await transaction.siteFeed.findUnique({
        where: {
          siteClientId_feedId: {
            siteClientId: ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID,
            feedId: feed.id
          }
        },
        select: { feedId: true }
      });

      if (existingOnboarding !== null) {
        const currentFeed = await transaction.feed.findUniqueOrThrow({
          where: { id: feed.id },
          select: feedSelect
        });
        return {
          httpStatus: 200,
          body: {
            status: "already_exists",
            requestRef,
            feed: responseFeed(currentFeed, request.sourceHost),
            nextSteps: existingNextSteps(currentFeed),
            message: "Feed onboarding already exists for this source host.",
            generatedAt
          }
        };
      }

      await transaction.siteFeed.create({
        data: {
          siteClientId: ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID,
          feedId: feed.id,
          createdAt: now
        }
      });

      const updated = await transaction.feed.update({
        where: { id: feed.id },
        data: {
          title: feed.title === null && request.label !== null ? request.label : undefined,
          subscriberCount: { increment: 1 },
          nextCheckAt: feed.subscriberCount <= 0 ? now : (feed.nextCheckAt ?? now),
          errorCount: feed.subscriberCount <= 0 ? 0 : undefined,
          etag: feed.subscriberCount <= 0 ? null : undefined,
          lastModified: feed.subscriberCount <= 0 ? null : undefined
        },
        select: feedSelect
      });

      return {
        httpStatus: 201,
        body: {
          status: "created",
          requestRef,
          feed: responseFeed(updated, request.sourceHost),
          nextSteps: createdNextSteps(updated),
          message: "Feed onboarding was accepted through the existing due-feed path.",
          generatedAt
        }
      };
    });
  }
}

const feedSelect = {
  id: true,
  url: true,
  title: true,
  active: true,
  subscriberCount: true,
  nextCheckAt: true
} as const;

function parseRequestBody(value: unknown): ParsedFeedOnboardingRequest | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "feedUrl" && key !== "label")) return undefined;
  if (typeof value.feedUrl !== "string") return undefined;

  const parsedUrl = parseFeedUrl(value.feedUrl);
  if (parsedUrl === undefined) return undefined;

  const label = value.label === undefined || value.label === null ? null : parseLabel(value.label);
  if (label === undefined) return undefined;

  return {
    ...parsedUrl,
    label
  };
}

function parseFeedUrl(value: string): Pick<ParsedFeedOnboardingRequest, "canonicalUrl" | "sourceHost"> | undefined {
  if (value.length < 12 || value.length > 2048 || value.trim() !== value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  if (parsed.hash !== "") return undefined;
  if (parsed.hostname.length < 1 || parsed.hostname.length > 253) return undefined;

  const sourceHost = safeSourceHost(parsed.hostname);
  if (sourceHost === null) return undefined;

  parsed.protocol = "https:";
  parsed.hostname = sourceHost;
  parsed.hash = "";
  const canonicalUrl = parsed.toString();
  if (canonicalUrl.length > 2048 || canonicalUrl.includes("#")) return undefined;

  return {
    canonicalUrl,
    sourceHost
  };
}

function parseLabel(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized === "") return null;
  if (normalized.length > 80 || unsafeTextPattern.test(normalized) || /https?:\/\//iu.test(normalized)) return undefined;
  return normalized;
}

function responseFeed(feed: FeedProjection, sourceHost: string): NonNullable<AdminFeedOnboardingResponse["feed"]> {
  const active = feed.active === true;
  const eligibleForRecheck = active && feed.subscriberCount > 0;
  return {
    displayId: displayId("feed", feed.id),
    sourceHost,
    state: active ? (eligibleForRecheck ? "active" : "pending") : "disabled",
    eligibleForRecheck
  };
}

function createdNextSteps(feed: FeedProjection): readonly string[] {
  if (feed.active === true && feed.subscriberCount > 0) {
    return [
      "Deploy this source change through the operator-owned production path.",
      "After onboarding, refresh Operations Drilldown and request feed recheck only from an eligible row."
    ];
  }

  return ["Refresh Operations Drilldown after deployment to confirm the feed state."];
}

function existingNextSteps(feed: FeedProjection): readonly string[] {
  if (feed.active === true && feed.subscriberCount > 0) {
    return ["Refresh Operations Drilldown; the existing feed should remain eligible when the source host is safe."];
  }

  return ["Existing feed is present but not eligible; resolve feed state before recheck acceptance."];
}

function unavailableResponse(generatedAt: string, message: string): AdminFeedOnboardingResponse {
  return {
    status: "unavailable",
    requestRef: null,
    feed: null,
    nextSteps: [],
    message,
    generatedAt
  };
}

function rateLimitedResponse(generatedAt: string, message: string): AdminFeedOnboardingResponse {
  return {
    status: "rate_limited",
    requestRef: null,
    feed: null,
    nextSteps: [],
    message,
    generatedAt
  };
}

function redisKey(
  config: Extract<AdminAuthConfig, { readonly mode: "single_admin" }>,
  scope: string,
  left: string,
  right: string
): string {
  return `${config.redisPrefix}:${scope}:${safeDigest(config, left)}:${safeDigest(config, right)}`;
}

function safeDigest(config: Extract<AdminAuthConfig, { readonly mode: "single_admin" }>, value: string): string {
  return createHmac("sha256", config.sessionSecret).update(value, "utf8").digest("base64url");
}

function displayId(prefix: "feed", value: bigint): string {
  const digest = createHash("sha256").update(`${prefix}:${String(value)}`).digest("hex").slice(0, 10);
  return `${prefix}_${digest}`;
}

function safeSourceHost(value: string): string | null {
  const hostname = value.toLowerCase().replace(/\.$/u, "");
  if (hostname.length < 1 || hostname.length > 253) return null;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return null;
  if (hostname === "host.docker.internal" || hostname.endsWith(".docker.internal")) return null;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (hostname.endsWith(".lan") || hostname.endsWith(".home") || hostname.endsWith(".corp")) return null;
  if (hostname.includes(":") || hostname.includes("/") || hostname.includes("?") || hostname.includes("_")) return null;
  if (!hostname.includes(".")) return null;
  if (isUnsafeIpv4(hostname)) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return null;
  if (!/^[a-z0-9.-]+$/u.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.some((label) => label.length < 1 || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return null;
  return hostname;
}

function isUnsafeIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts;
  if (first === undefined || second === undefined || third === undefined) return true;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && (second === 0 || second === 168)) return true;
  if (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  if (first >= 224) return true;
  return false;
}

function parseIdempotencyRecord(value: string):
  | {
      readonly requestDigest: string;
      readonly body: AdminFeedOnboardingResponse;
    }
  | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.requestDigest !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(parsed.requestDigest)) {
      return undefined;
    }
    if (!isFeedOnboardingResponse(parsed.body)) return undefined;
    return {
      requestDigest: parsed.requestDigest,
      body: parsed.body
    };
  } catch {
    return undefined;
  }
}

function isFeedOnboardingResponse(value: unknown): value is AdminFeedOnboardingResponse {
  if (!isRecord(value)) return false;
  if (value.status !== "created" && value.status !== "already_exists") return false;
  if (typeof value.requestRef !== "string" || !/^onboard_[A-Za-z0-9_-]{12,64}$/u.test(value.requestRef)) return false;
  if (!isRecord(value.feed)) return false;
  if (typeof value.feed.displayId !== "string" || !/^feed_[a-f0-9]{10}$/u.test(value.feed.displayId)) return false;
  if (typeof value.feed.sourceHost !== "string" || safeSourceHost(value.feed.sourceHost) === null) return false;
  if (value.feed.state !== "pending" && value.feed.state !== "active" && value.feed.state !== "disabled") return false;
  if (typeof value.feed.eligibleForRecheck !== "boolean") return false;
  if (
    !Array.isArray(value.nextSteps) ||
    value.nextSteps.some((step) => typeof step !== "string" || unsafeTextPattern.test(step) || /https?:\/\//iu.test(step))
  ) {
    return false;
  }
  return typeof value.message === "string" && !unsafeTextPattern.test(value.message) && !/https?:\/\//iu.test(value.message) && typeof value.generatedAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
