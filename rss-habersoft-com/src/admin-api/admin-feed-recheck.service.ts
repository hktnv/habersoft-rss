import { createHash, createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { RuntimeConfig, type AdminAuthConfig } from "../configuration/runtime-config";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { PostgresService } from "../persistence/postgres.service";
import { RedisService } from "../redis/redis.service";
import { parseFeedRecheckActionRef } from "./admin-feed-recheck-action-ref";
import type { AdminFeedRecheckResponse } from "./admin-feed-recheck.types";

export const ADMIN_FEED_RECHECK_BODY_LIMIT_BYTES = 2048;

type RequestFeedRecheckInput = {
  readonly body: unknown;
  readonly idempotencyKey: string;
  readonly sessionKey: string;
  readonly now?: Date;
};

type RequestFeedRecheckResult = {
  readonly httpStatus: number;
  readonly body: AdminFeedRecheckResponse;
};

const cooldownSeconds = 300;
const idempotencyTtlSeconds = 300;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{16,80}$/u;
const acceptedReason = "operator_request";
const unsafeTextPattern = /(?:secret|password|token|cookie|authorization|bearer|database_url|redis_url)\s*[:=]/iu;

@Injectable()
export class AdminFeedRecheckService {
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

  public async requestFeedRecheck(input: RequestFeedRecheckInput): Promise<RequestFeedRecheckResult> {
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
        body: unavailableResponse(generatedAt, "Feed recheck request body was not accepted.")
      };
    }

    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      return {
        httpStatus: 400,
        body: unavailableResponse(generatedAt, "Feed recheck idempotency key was not accepted.")
      };
    }

    const feedId = parseFeedRecheckActionRef(parsedBody.actionRef, config.sessionSecret);
    if (feedId === undefined) {
      return notFound(generatedAt);
    }

    const feed = await this.database.feed.findUnique({
      where: { id: feedId },
      select: {
        id: true,
        url: true,
        active: true,
        subscriberCount: true,
        nextCheckAt: true
      }
    });

    if (feed === null) {
      return notFound(generatedAt);
    }

    const target = {
      displayId: displayId("feed", feed.id),
      sourceHost: safeSourceHost(feed.url)
    };

    if (feed.active !== true || feed.subscriberCount <= 0 || target.sourceHost === null) {
      return {
        httpStatus: 200,
        body: {
          status: "unavailable",
          requestId: null,
          target,
          queued: false,
          cooldownSeconds: null,
          message: "This feed is not eligible for a safe admin recheck request.",
          generatedAt
        }
      };
    }

    const idempotencyKey = redisKey(config, "feed_recheck:idempotency", input.sessionKey, input.idempotencyKey);
    const actionDigest = safeDigest(config, feedId.toString(10));
    const existing = await this.redis.command().call("GET", idempotencyKey);
    if (typeof existing === "string") {
      const replay = parseIdempotencyRecord(existing);
      if (replay?.actionDigest === actionDigest) {
        return {
          httpStatus: 200,
          body: {
            status: "already_pending",
            requestId: replay.requestId,
            target,
            queued: false,
            cooldownSeconds: null,
            message: "This feed recheck request was already accepted for this admin session.",
            generatedAt
          }
        };
      }

      return {
        httpStatus: 409,
        body: {
          status: "rate_limited",
          requestId: null,
          target,
          queued: false,
          cooldownSeconds: idempotencyTtlSeconds,
          message: "This idempotency key has already been used for another feed recheck request.",
          generatedAt
        }
      };
    }

    const cooldownKey = redisKey(config, "feed_recheck:cooldown", "target", feed.id.toString(10));
    const ttl = await this.redis.command().call("TTL", cooldownKey);
    if (typeof ttl === "number" && ttl > 0) {
      return {
        httpStatus: 429,
        body: {
          status: "rate_limited",
          requestId: null,
          target,
          queued: false,
          cooldownSeconds: ttl,
          message: "This feed recently received a recheck request; wait before trying again.",
          generatedAt
        }
      };
    }

    if (feed.nextCheckAt !== null && feed.nextCheckAt.getTime() <= now.getTime()) {
      return {
        httpStatus: 200,
        body: {
          status: "already_pending",
          requestId: null,
          target,
          queued: false,
          cooldownSeconds: null,
          message: "This feed is already due for the existing recheck path.",
          generatedAt
        }
      };
    }

    const requestId = `recheck_${randomBytes(12).toString("base64url")}`;
    const updated = await this.database.feed.updateMany({
      where: {
        id: feed.id,
        active: true,
        subscriberCount: { gt: 0 }
      },
      data: {
        nextCheckAt: now
      }
    });

    if (updated.count !== 1) {
      return notFound(generatedAt);
    }

    await this.redis.command().call(
      "SET",
      idempotencyKey,
      JSON.stringify({ requestId, actionDigest }),
      "EX",
      idempotencyTtlSeconds
    );
    await this.redis.command().call("SET", cooldownKey, requestId, "EX", cooldownSeconds);

    return {
      httpStatus: 202,
      body: {
        status: "accepted",
        requestId,
        target,
        queued: true,
        cooldownSeconds,
        message: "Feed recheck was requested through the existing due-feed path.",
        generatedAt
      }
    };
  }
}

function parseRequestBody(value: unknown): { readonly actionRef: string; readonly reason: typeof acceptedReason | null } | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "actionRef" && key !== "reason")) return undefined;
  if (typeof value.actionRef !== "string") return undefined;
  if (value.reason !== undefined && value.reason !== null && value.reason !== acceptedReason) return undefined;
  return {
    actionRef: value.actionRef,
    reason: value.reason ?? null
  };
}

function parseIdempotencyRecord(value: string): { readonly requestId: string; readonly actionDigest: string } | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.requestId !== "string" || !/^recheck_[A-Za-z0-9_-]{12,64}$/u.test(parsed.requestId)) {
      return undefined;
    }
    if (typeof parsed.actionDigest !== "string" || !/^[A-Za-z0-9_-]{32,128}$/u.test(parsed.actionDigest)) {
      return undefined;
    }
    return {
      requestId: parsed.requestId,
      actionDigest: parsed.actionDigest
    };
  } catch {
    return undefined;
  }
}

function unavailableResponse(generatedAt: string, message: string): AdminFeedRecheckResponse {
  return {
    status: "unavailable",
    requestId: null,
    target: null,
    queued: false,
    cooldownSeconds: null,
    message,
    generatedAt
  };
}

function notFound(generatedAt: string): RequestFeedRecheckResult {
  return {
    httpStatus: 404,
    body: {
      status: "not_found",
      requestId: null,
      target: null,
      queued: false,
      cooldownSeconds: null,
      message: "Feed recheck target was not found or is no longer eligible.",
      generatedAt
    }
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
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostname.length < 1 || hostname.length > 120 || hostname.includes("/") || hostname.includes("?")) return null;
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (hostname.endsWith(".lan") || hostname.endsWith(".home") || hostname.endsWith(".corp")) return null;
  if (hostname.includes(":")) return null;
  if (isPrivateIpv4(hostname)) return null;
  if (!hostname.includes(".")) return null;
  return hostname;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const first = parts[0];
  const second = parts[1];
  if (typeof first !== "number" || typeof second !== "number") return true;
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeFeedRecheckMessage(value: string): boolean {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 180 && !unsafeTextPattern.test(normalized) && !/https?:\/\//iu.test(normalized);
}
