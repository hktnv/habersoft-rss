import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AuthorizationHeaderParser } from "../../src/tenant-auth/authorization-header.parser";
import type { TenantJwtVerificationResult } from "../../src/tenant-auth/tenant-auth.types";
import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";
import { TenantJwtAuthGuard } from "../../src/tenant-auth/tenant-jwt-auth.guard";
import { TenantJwtVerifier } from "../../src/tenant-auth/tenant-jwt.verifier";
import { ListTenantEntriesUseCase } from "../../src/tenant-entries/list-tenant-entries.use-case";
import { TenantEntriesController } from "../../src/tenant-entries/tenant-entries.controller";
import { TenantRateLimitGuard } from "../../src/tenant-rate-limit/tenant-rate-limit.guard";
import { TenantRateLimitService } from "../../src/tenant-rate-limit/tenant-rate-limit.service";
import type { TenantRateLimitConsumeResult } from "../../src/tenant-rate-limit/tenant-rate-limit.types";

describe("TenantEntriesController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let verify: jest.Mock<Promise<TenantJwtVerificationResult>, [string]>;
  let consumeRateLimit: jest.Mock<Promise<TenantRateLimitConsumeResult>, [string]>;
  let listTenantEntries: jest.Mocked<Pick<ListTenantEntriesUseCase, "execute">>;

  beforeEach(async () => {
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
    listTenantEntries = {
      execute: jest.fn().mockResolvedValue([
        {
          id: 1n,
          guid: "guid-1",
          title: "Entry 1",
          url: "https://example.test/entry-1",
          publishedAt: null,
          effectiveAt: new Date("2026-06-20T10:00:00.000Z"),
          summary: "Summary",
          feedUrl: "https://example.test/feed.xml",
          hasDetail: true,
          primaryImage: "https://example.test/image.jpg",
          tags: ["tag-a"],
          author: "Author"
        }
      ])
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantEntriesController],
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
          provide: ListTenantEntriesUseCase,
          useValue: listTenantEntries
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

  it("returns a bare array and forwards bounded defaults", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(200);
    expect(listTenantEntries.execute).toHaveBeenCalledWith({
      siteClientId: "site-a",
      offset: 0,
      limit: 50
    });
    expect(JSON.parse(response.payload)).toEqual([
      {
        id: "1",
        guid: "guid-1",
        title: "Entry 1",
        url: "https://example.test/entry-1",
        published_at: null,
        effective_at: "2026-06-20T10:00:00.000Z",
        summary: "Summary",
        feed_url: "https://example.test/feed.xml",
        has_detail: true,
        primary_image: "https://example.test/image.jpg",
        tags: ["tag-a"],
        author: "Author"
      }
    ]);
  });

  it("consumes quota for authenticated validation failures before the use case", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries?site_client_id=site-b",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.payload)).toMatchObject({ error_code: "VALIDATION_FAILED" });
    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(listTenantEntries.execute).not.toHaveBeenCalled();
  });

  it("does not consume quota when auth fails", async () => {
    verify.mockResolvedValueOnce({
      ok: false,
      outcome: "unauthenticated",
      reason: "jwt_signature_or_claims_invalid"
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(401);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(listTenantEntries.execute).not.toHaveBeenCalled();
  });

  it("short-circuits 429 before the use case", async () => {
    consumeRateLimit.mockResolvedValueOnce({
      outcome: "limited",
      retryAfterSeconds: 9
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("9");
    expect(listTenantEntries.execute).not.toHaveBeenCalled();
  });

  it("short-circuits 503 before the use case", async () => {
    consumeRateLimit.mockResolvedValueOnce({ outcome: "unavailable" });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(503);
    expect(listTenantEntries.execute).not.toHaveBeenCalled();
  });
});
