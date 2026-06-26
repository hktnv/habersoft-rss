import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";
import { JwksCacheService } from "./jwks-cache.service";
import { loadJoseRuntime } from "./jose-runtime";
import { createTenantPrincipal } from "./tenant-principal";
import { TenantJwtVerificationResult } from "./tenant-auth.types";

@Injectable()
export class TenantJwtVerifier {
  public constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly jwks: JwksCacheService
  ) {}

  public async verify(token: string): Promise<TenantJwtVerificationResult> {
    const tenantAuth = this.config.tenantAuth;
    if (tenantAuth === undefined) {
      return { ok: false, outcome: "unavailable", reason: "jwks_unavailable" };
    }

    const jose = await loadJoseRuntime();
    let header: ReturnType<typeof jose.decodeProtectedHeader>;

    try {
      header = jose.decodeProtectedHeader(token);
    } catch {
      return { ok: false, outcome: "unauthenticated", reason: "jwt_header_invalid" };
    }

    if (header.alg !== tenantAuth.algorithm) {
      return { ok: false, outcome: "unauthenticated", reason: "jwt_algorithm_unsupported" };
    }

    if (typeof header.kid !== "string" || header.kid.trim() === "") {
      return { ok: false, outcome: "unauthenticated", reason: "jwt_kid_missing" };
    }

    const keyResult = await this.jwks.getKey(header.kid);
    if (!keyResult.ok) {
      return keyResult.reason === "jwks_unavailable"
        ? { ok: false, outcome: "unavailable", reason: "jwks_unavailable" }
        : { ok: false, outcome: "unauthenticated", reason: "jwt_key_not_found" };
    }

    try {
      const { payload } = await jose.jwtVerify(token, keyResult.key, {
        algorithms: [tenantAuth.algorithm],
        issuer: tenantAuth.issuer,
        audience: tenantAuth.audience,
        clockTolerance: tenantAuth.clockToleranceSeconds
      });

      const claims = validateTenantClaims(payload, tenantAuth.audience, tenantAuth.requiredScope);
      if (!claims.ok) {
        return claims.failure;
      }

      return {
        ok: true,
        principal: createTenantPrincipal({
          subject: claims.subject,
          scopes: claims.scopes,
          tokenId: claims.tokenId
        })
      };
    } catch {
      return { ok: false, outcome: "unauthenticated", reason: "jwt_signature_or_claims_invalid" };
    }
  }
}

type TenantClaimsResult =
  | {
      readonly ok: true;
      readonly subject: string;
      readonly scopes: readonly string[];
      readonly tokenId?: string;
    }
  | {
      readonly ok: false;
      readonly failure: TenantJwtVerificationResult;
    };

function validateTenantClaims(
  payload: Record<string, unknown>,
  audience: string,
  requiredScope: string
): TenantClaimsResult {
  if (!Array.isArray(payload.aud) || !payload.aud.includes(audience)) {
    return {
      ok: false,
      failure: { ok: false, outcome: "unauthenticated", reason: "jwt_audience_invalid" }
    };
  }

  if (typeof payload.sub !== "string" || payload.sub.trim() === "") {
    return {
      ok: false,
      failure: { ok: false, outcome: "unauthenticated", reason: "jwt_subject_invalid" }
    };
  }

  if (typeof payload.client_id !== "string" || payload.client_id.trim() === "" || payload.client_id !== payload.sub) {
    return {
      ok: false,
      failure: { ok: false, outcome: "unauthenticated", reason: "jwt_client_id_invalid" }
    };
  }

  if (typeof payload.scope !== "string") {
    return {
      ok: false,
      failure: { ok: false, outcome: "forbidden", reason: "insufficient_scope" }
    };
  }

  const scopes = payload.scope.split(/\s+/u).filter((scope) => scope !== "");
  if (!scopes.includes(requiredScope)) {
    return {
      ok: false,
      failure: { ok: false, outcome: "forbidden", reason: "insufficient_scope" }
    };
  }

  return {
    ok: true,
    subject: payload.sub,
    scopes,
    ...(typeof payload.jti === "string" && payload.jti.trim() !== "" ? { tokenId: payload.jti } : {})
  };
}
