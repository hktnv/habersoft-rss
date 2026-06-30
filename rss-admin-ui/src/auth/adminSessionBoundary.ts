import type { AdminSessionStatus } from "./adminSessionClient";

export type AdminAuthBlockReason =
  | "admin_auth_not_configured"
  | "authority_required_before_business_admin_features"
  | "configuration_missing";

export type FutureAdminAuthorityRequirement =
  | "csrf_xss_stance"
  | "tenant_admin_identity_boundary"
  | "role_permission_model"
  | "authenticated_field_classification"
  | "backend_route_inventory"
  | "production_activation_evidence"
  | "production_secret_provisioning";

export type AdminAuthBoundaryState =
  | {
      readonly kind: "same_origin_session";
    }
  | {
      readonly kind: "not_configured";
    }
  | {
      readonly kind: "authority_required";
      readonly requirements: readonly FutureAdminAuthorityRequirement[];
    }
  | {
      readonly kind: "blocked";
      readonly reason: AdminAuthBlockReason;
    };

export const futureAdminAuthorityRequirements: readonly FutureAdminAuthorityRequirement[] = [
  "csrf_xss_stance",
  "tenant_admin_identity_boundary",
  "role_permission_model",
  "authenticated_field_classification",
  "backend_route_inventory",
  "production_activation_evidence",
  "production_secret_provisioning"
];

export const defaultAdminAuthBoundaryState: AdminAuthBoundaryState = {
  kind: "same_origin_session"
};

export const adminAuthBoundaryContract = {
  statusDashboardPublic: false,
  protectedAdminShellPresent: true,
  sameOriginAdminSessionPath: "/admin-auth/session",
  sameOriginAdminLoginPath: "/admin-auth/login",
  sameOriginAdminLogoutPath: "/admin-auth/logout",
  sameOriginAdminOperationsSummaryPath: "/admin-api/operations/summary",
  sameOriginAdminSessionSentinelOnly: false,
  realAuthImplemented: true,
  defaultAllowsProtectedContent: false,
  browserCredentialExchangeImplemented: true,
  browserCredentialPersistenceImplemented: false,
  fakeAdminIdentityAllowed: false,
  privilegedBusinessDataAllowed: false,
  adminApiWritesImplemented: false,
  futureAuthorityRequiredBeforeBusinessAdminFeatures: true,
  requiredFutureAuthority: futureAdminAuthorityRequirements
} as const;

export function resolveAdminAuthBoundaryState(): AdminAuthBoundaryState {
  return defaultAdminAuthBoundaryState;
}

export function canRenderProtectedAdminContent(
  state: AdminAuthBoundaryState,
  sessionStatus?: AdminSessionStatus
): boolean {
  return state.kind === "same_origin_session" && sessionStatus?.kind === "authenticated";
}

export function describeAdminAuthBoundaryState(state: AdminAuthBoundaryState): string {
  switch (state.kind) {
    case "same_origin_session":
      return "Admin access is controlled by the same-origin session contract.";
    case "not_configured":
      return "Admin access is not configured yet.";
    case "authority_required":
      return "Business admin features require a future authority-backed milestone.";
    case "blocked":
      return describeBlockReason(state.reason);
  }
}

function describeBlockReason(reason: AdminAuthBlockReason): string {
  switch (reason) {
    case "admin_auth_not_configured":
      return "Admin auth/session is not configured.";
    case "authority_required_before_business_admin_features":
      return "Business admin features require explicit future authority.";
    case "configuration_missing":
      return "Required admin auth/session configuration is missing.";
  }
}
