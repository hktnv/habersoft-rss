import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { TenantFeedsController } from "../../src/tenant-feeds/tenant-feeds.controller";
import { ListTenantFeedsUseCase } from "../../src/tenant-feeds/list-tenant-feeds.use-case";
import { SubscribeFeedUseCase } from "../../src/tenant-feeds/subscribe-feed.use-case";
import { UnsubscribeFeedUseCase } from "../../src/tenant-feeds/unsubscribe-feed.use-case";
import { AuthorizationHeaderParser } from "../../src/tenant-auth/authorization-header.parser";
import type { TenantJwtVerificationResult } from "../../src/tenant-auth/tenant-auth.types";
import { TenantJwtAuthGuard } from "../../src/tenant-auth/tenant-jwt-auth.guard";
import { TenantJwtVerifier } from "../../src/tenant-auth/tenant-jwt.verifier";
import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";
import { TenantRateLimitGuard } from "../../src/tenant-rate-limit/tenant-rate-limit.guard";
import { TenantRateLimitService } from "../../src/tenant-rate-limit/tenant-rate-limit.service";
import type { TenantRateLimitConsumeResult } from "../../src/tenant-rate-limit/tenant-rate-limit.types";

describe("TenantFeedsController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let subscribeFeed: jest.Mocked<Pick<SubscribeFeedUseCase, "execute">>;
  let listTenantFeeds: jest.Mocked<Pick<ListTenantFeedsUseCase, "execute">>;
  let unsubscribeFeed: jest.Mocked<Pick<UnsubscribeFeedUseCase, "execute">>;
  let verify: jest.Mock<Promise<TenantJwtVerificationResult>, [string]>;
  let consumeRateLimit: jest.Mock<Promise<TenantRateLimitConsumeResult>, [string]>;

  beforeEach(async () => {
    subscribeFeed = {
      execute: jest.fn()
    };
    listTenantFeeds = {
      execute: jest.fn()
    };
    unsubscribeFeed = {
      execute: jest.fn()
    };

    verify = jest.fn<Promise<TenantJwtVerificationResult>, [string]>().mockResolvedValue({
      ok: true,
      principal: createTenantPrincipal({
        subject: "site-a",
        scopes: ["services:access"]
      })
    });
    consumeRateLimit = jest.fn<Promise<TenantRateLimitConsumeResult>, [string]>().mockResolvedValue({
      outcome: "allowed"
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantFeedsController],
      providers: [
        AuthorizationHeaderParser,
        TenantJwtAuthGuard,
        TenantRateLimitGuard,
        {
          provide: TenantJwtVerifier,
          useValue: { verify }
        },
        {
          provide: TenantRateLimitService,
          useValue: { consume: consumeRateLimit }
        },
        {
          provide: SubscribeFeedUseCase,
          useValue: subscribeFeed
        },
        {
          provide: ListTenantFeedsUseCase,
          useValue: listTenantFeeds
        },
        {
          provide: UnsubscribeFeedUseCase,
          useValue: unsubscribeFeed
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns 201 for a newly subscribed feed", async () => {
    subscribeFeed.execute.mockResolvedValue({
      outcome: "created_feed",
      feedId: 1n,
      url: "https://example.test/rss.xml"
    });

    const response = await fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" },
      payload: { url: "https://example.test/rss.xml" }
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toEqual({
      feed_id: "1",
      url: "https://example.test/rss.xml",
      subscribed: true,
      created_feed: true
    });
  });

  it("returns 200 for an existing same-tenant subscription", async () => {
    subscribeFeed.execute.mockResolvedValue({
      outcome: "already_subscribed",
      feedId: 1n,
      url: "https://example.test/rss.xml"
    });

    const response = await fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" },
      payload: { url: "https://example.test/rss.xml" }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({
      feed_id: "1",
      url: "https://example.test/rss.xml",
      subscribed: true,
      already_subscribed: true
    });
  });

  it("maps inactive feeds to the bounded FEED_ADMIN_DISABLED response", async () => {
    subscribeFeed.execute.mockResolvedValue({
      outcome: "feed_admin_disabled",
      feedId: 1n,
      url: "https://example.test/rss.xml"
    });

    const response = await fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" },
      payload: { url: "https://example.test/rss.xml" }
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "FEED_ADMIN_DISABLED" });
  });

  it("rejects tenant override body fields before reaching the use case", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" },
      payload: { url: "https://example.test/rss.xml", site_client_id: "site-b" }
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(subscribeFeed.execute).not.toHaveBeenCalled();
  });

  it("lists only the public tenant feed fields", async () => {
    listTenantFeeds.execute.mockResolvedValue([
      {
        feedId: 1n,
        url: "https://example.test/rss.xml",
        title: null,
        active: true,
        subscribedAt: new Date("2026-06-20T10:00:00.000Z")
      }
    ]);

    const response = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual([
      {
        feed_id: "1",
        url: "https://example.test/rss.xml",
        title: null,
        active: true,
        subscribed_at: "2026-06-20T10:00:00.000Z"
      }
    ]);
  });

  it("rejects GET and DELETE query parameters", async () => {
    const listResponse = await fastify.inject({
      method: "GET",
      url: "/api/feeds?site_client_id=site-b",
      headers: { authorization: "Bearer token" }
    });
    const deleteResponse = await fastify.inject({
      method: "DELETE",
      url: "/api/feeds/1?site_client_id=site-b",
      headers: { authorization: "Bearer token" }
    });

    expect(listResponse.statusCode).toBe(422);
    expect(deleteResponse.statusCode).toBe(422);
    expect(listTenantFeeds.execute).not.toHaveBeenCalled();
    expect(unsubscribeFeed.execute).not.toHaveBeenCalled();
  });

  it("unsubscribes idempotently with 204 and validates feed_id", async () => {
    unsubscribeFeed.execute.mockResolvedValue({ outcome: "already_absent" });

    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/feeds/10",
      headers: { authorization: "Bearer token" }
    });
    const invalidResponse = await fastify.inject({
      method: "DELETE",
      url: "/api/feeds/01",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(204);
    expect(response.payload).toBe("");
    expect(invalidResponse.statusCode).toBe(422);
    expect(unsubscribeFeed.execute).toHaveBeenCalledTimes(1);
  });

  it("does not consume quota when tenant auth rejects the request", async () => {
    verify.mockResolvedValueOnce({
      ok: false,
      outcome: "unauthenticated",
      reason: "jwt_signature_or_claims_invalid"
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(401);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(listTenantFeeds.execute).not.toHaveBeenCalled();
  });

  it("short-circuits with 429 and Retry-After without public rate-limit headers", async () => {
    consumeRateLimit.mockResolvedValueOnce({
      outcome: "limited",
      retryAfterSeconds: 7
    });

    const response = await fastify.inject({
      method: "POST",
      url: "/api/feeds",
      headers: { authorization: "Bearer token" },
      payload: { url: "https://example.test/rss.xml" }
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("7");
    expect(response.headers["x-ratelimit-limit"]).toBeUndefined();
    expect(response.headers["ratelimit-limit"]).toBeUndefined();
    expect(JSON.parse(response.payload)).not.toHaveProperty("error_code");
    expect(subscribeFeed.execute).not.toHaveBeenCalled();
  });

  it("short-circuits with 503 when rate-limit infrastructure is unavailable", async () => {
    consumeRateLimit.mockResolvedValueOnce({
      outcome: "unavailable"
    });

    const response = await fastify.inject({
      method: "DELETE",
      url: "/api/feeds/1",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(503);
    expect(unsubscribeFeed.execute).not.toHaveBeenCalled();
  });
});
