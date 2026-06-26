import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { AuthorizationHeaderParser } from "../../src/tenant-auth/authorization-header.parser";
import type { TenantJwtVerificationResult } from "../../src/tenant-auth/tenant-auth.types";
import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";
import { TenantJwtAuthGuard } from "../../src/tenant-auth/tenant-jwt-auth.guard";
import { TenantJwtVerifier } from "../../src/tenant-auth/tenant-jwt.verifier";
import { GetTenantEntryDetailUseCase } from "../../src/tenant-entry-detail/get-tenant-entry-detail.use-case";
import { TenantEntryDetailController } from "../../src/tenant-entry-detail/tenant-entry-detail.controller";
import type { TenantEntryDetailItem } from "../../src/tenant-entry-detail/tenant-entry-detail.types";
import { TenantRateLimitGuard } from "../../src/tenant-rate-limit/tenant-rate-limit.guard";
import { TenantRateLimitService } from "../../src/tenant-rate-limit/tenant-rate-limit.service";
import type { TenantRateLimitConsumeResult } from "../../src/tenant-rate-limit/tenant-rate-limit.types";

describe("TenantEntryDetailController", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let verify: jest.Mock<Promise<TenantJwtVerificationResult>, [string]>;
  let consumeRateLimit: jest.Mock<Promise<TenantRateLimitConsumeResult>, [string]>;
  let getTenantEntryDetail: jest.Mocked<Pick<GetTenantEntryDetailUseCase, "execute">>;

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
    getTenantEntryDetail = {
      execute: jest.fn().mockResolvedValue(detailItem())
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantEntryDetailController],
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
          provide: GetTenantEntryDetailUseCase,
          useValue: getTenantEntryDetail
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

  it("returns detail and uses only the verified principal tenant", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries/1/detail",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(200);
    expect(getTenantEntryDetail.execute).toHaveBeenCalledWith({ siteClientId: "site-a", entryId: 1n });
    expect(JSON.parse(response.payload)).toMatchObject({
      entry_id: "1",
      has_detail: true,
      detail: "<p>Detail</p>"
    });
  });

  it("consumes quota for authenticated invalid id and query before the use case", async () => {
    const invalidId = await fastify.inject({
      method: "GET",
      url: "/api/entries/0/detail",
      headers: { authorization: "Bearer token" }
    });
    const invalidQuery = await fastify.inject({
      method: "GET",
      url: "/api/entries/1/detail?site_client_id=site-b",
      headers: { authorization: "Bearer token" }
    });

    expect(invalidId.statusCode).toBe(422);
    expect(invalidQuery.statusCode).toBe(422);
    expect(consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(getTenantEntryDetail.execute).not.toHaveBeenCalled();
  });

  it("does not consume quota when auth fails", async () => {
    verify.mockResolvedValueOnce({
      ok: false,
      outcome: "unauthenticated",
      reason: "jwt_signature_or_claims_invalid"
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries/1/detail",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(401);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(getTenantEntryDetail.execute).not.toHaveBeenCalled();
  });

  it("counts not found requests and returns generic 404", async () => {
    getTenantEntryDetail.execute.mockResolvedValueOnce(null);

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries/999/detail",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(404);
    expect(consumeRateLimit).toHaveBeenCalledTimes(1);
  });

  it("short-circuits 429 before validation and the use case", async () => {
    consumeRateLimit.mockResolvedValueOnce({
      outcome: "limited",
      retryAfterSeconds: 9
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/api/entries/1/detail",
      headers: { authorization: "Bearer token" }
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("9");
    expect(getTenantEntryDetail.execute).not.toHaveBeenCalled();
  });
});

function detailItem(): TenantEntryDetailItem {
  return {
    entryId: 1n,
    hasDetail: true,
    detail: "<p>Detail</p>",
    images: [],
    videos: [],
    tags: [],
    author: null,
    meta: {},
    detailExtraction: {
      status: "ok",
      attemptedAt: new Date("2026-06-20T10:00:01.000Z"),
      finalizedAt: new Date("2026-06-20T10:00:02.000Z"),
      errorCode: null
    }
  };
}
