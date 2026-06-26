import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthorizationHeaderParser } from "../../src/tenant-auth/authorization-header.parser";
import { TENANT_PRINCIPAL_REQUEST_KEY } from "../../src/tenant-auth/tenant-auth.constants";
import type {
  TenantAuthenticatedRequest,
  TenantJwtVerificationResult
} from "../../src/tenant-auth/tenant-auth.types";
import { TenantJwtAuthGuard } from "../../src/tenant-auth/tenant-jwt-auth.guard";
import { TenantJwtVerifier } from "../../src/tenant-auth/tenant-jwt.verifier";
import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";

type ProtectedRequest = FastifyRequest & TenantAuthenticatedRequest;

@Controller("tenant-probe")
class TenantProbeController {
  @Get()
  @UseGuards(TenantJwtAuthGuard)
  public show(@Req() request: ProtectedRequest): { readonly siteClientId: string | undefined } {
    return {
      siteClientId: request[TENANT_PRINCIPAL_REQUEST_KEY]?.siteClientId
    };
  }
}

describe("TenantJwtAuthGuard", () => {
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance;
  let verify: jest.Mock<Promise<TenantJwtVerificationResult>, [string]>;

  beforeEach(async () => {
    verify = jest.fn<Promise<TenantJwtVerificationResult>, [string]>();
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantProbeController],
      providers: [
        AuthorizationHeaderParser,
        TenantJwtAuthGuard,
        {
          provide: TenantJwtVerifier,
          useValue: {
            verify
          }
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

  it("returns 401 before verification when Authorization is missing", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/tenant-probe"
    });

    expect(response.statusCode).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it("attaches the principal for a valid token", async () => {
    verify.mockResolvedValue({
      ok: true,
      principal: createTenantPrincipal({
        subject: "site-a",
        scopes: ["services:access"]
      })
    });

    const response = await fastify.inject({
      method: "GET",
      url: "/tenant-probe",
      headers: {
        authorization: "Bearer token"
      }
    });
    const body = JSON.parse(response.payload) as { readonly siteClientId?: string };

    expect(response.statusCode).toBe(200);
    expect(body.siteClientId).toBe("site-a");
    expect(verify).toHaveBeenCalledWith("token");
  });

  it("maps verifier outcomes to 403 and 503 without public auth error codes", async () => {
    verify.mockResolvedValueOnce({
      ok: false,
      outcome: "forbidden",
      reason: "insufficient_scope"
    });
    verify.mockResolvedValueOnce({
      ok: false,
      outcome: "unavailable",
      reason: "jwks_unavailable"
    });

    const forbidden = await fastify.inject({
      method: "GET",
      url: "/tenant-probe",
      headers: {
        authorization: "Bearer token"
      }
    });
    const unavailable = await fastify.inject({
      method: "GET",
      url: "/tenant-probe",
      headers: {
        authorization: "Bearer token"
      }
    });

    expect(forbidden.statusCode).toBe(403);
    expect(unavailable.statusCode).toBe(503);
    expect(forbidden.payload).not.toContain("insufficient_scope");
    expect(unavailable.payload).not.toContain("jwks_unavailable");
  });
});
