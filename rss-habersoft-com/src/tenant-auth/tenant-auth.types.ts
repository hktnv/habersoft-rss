import type { CryptoKey } from "jose";
import type { TENANT_PRINCIPAL_REQUEST_KEY } from "./tenant-auth.constants";

export type TenantAuthDependencyState = "up" | "down";

export type TenantAuthReadinessReport = {
  readonly status: TenantAuthDependencyState;
  readonly keyCount: number;
  readonly lastSuccessfulRefreshAt: Date | null;
  readonly lastFailureReason: TenantAuthFailureReason | null;
};

export type TenantAuthFailureReason =
  | "authorization_header_missing"
  | "authorization_header_malformed"
  | "authorization_header_multiple"
  | "jwt_header_invalid"
  | "jwt_algorithm_unsupported"
  | "jwt_kid_missing"
  | "jwks_unavailable"
  | "jwks_invalid"
  | "jwt_key_not_found"
  | "jwt_signature_or_claims_invalid"
  | "jwt_issuer_invalid"
  | "jwt_audience_invalid"
  | "jwt_subject_invalid"
  | "jwt_client_id_invalid"
  | "jwt_scope_invalid"
  | "insufficient_scope";

export type AuthorizationParseResult =
  | {
      readonly ok: true;
      readonly token: string;
    }
  | {
      readonly ok: false;
      readonly reason: TenantAuthFailureReason;
    };

export type TenantPrincipal = {
  readonly siteClientId: string;
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
  readonly tokenId?: string;
};

export type JwksVerificationKey = CryptoKey | Uint8Array;

export type TenantJwtVerificationResult =
  | {
      readonly ok: true;
      readonly principal: TenantPrincipal;
    }
  | {
      readonly ok: false;
      readonly outcome: "unauthenticated" | "forbidden" | "unavailable";
      readonly reason: TenantAuthFailureReason;
    };

export type JwksKeySet = {
  readonly keys: ReadonlyMap<string, JwksVerificationKey>;
  readonly loadedAt: Date;
};

export type TenantAuthenticatedRequest = {
  [TENANT_PRINCIPAL_REQUEST_KEY]?: TenantPrincipal;
};
