export type AdminAuthBlockReason =
  | "real_auth_not_implemented"
  | "authority_required_before_business_admin_features"
  | "configuration_missing";

export type FutureAdminAuthorityRequirement =
  | "browser_session_authority"
  | "credential_transport_policy"
  | "token_storage_policy"
  | "csrf_xss_stance"
  | "refresh_logout_semantics"
  | "same_origin_edge_policy"
  | "tenant_admin_identity_boundary"
  | "role_permission_model"
  | "authenticated_field_classification"
  | "backend_route_inventory"
  | "production_activation_evidence";

export type AdminAuthBoundaryState =
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
  "browser_session_authority",
  "credential_transport_policy",
  "token_storage_policy",
  "csrf_xss_stance",
  "refresh_logout_semantics",
  "same_origin_edge_policy",
  "tenant_admin_identity_boundary",
  "role_permission_model",
  "authenticated_field_classification",
  "backend_route_inventory",
  "production_activation_evidence"
];

export const defaultAdminAuthBoundaryState: AdminAuthBoundaryState = {
  kind: "not_configured"
};

export const adminAuthBoundaryContract = {
  statusDashboardPublic: true,
  protectedAdminShellPresent: true,
  realAuthImplemented: false,
  defaultAllowsProtectedContent: false,
  browserCredentialExchangeImplemented: false,
  browserCredentialPersistenceImplemented: false,
  fakeAdminIdentityAllowed: false,
  privilegedBusinessDataAllowed: false,
  adminApiWritesImplemented: false,
  futureAuthorityRequired: true,
  requiredFutureAuthority: futureAdminAuthorityRequirements
} as const;

export function resolveAdminAuthBoundaryState(): AdminAuthBoundaryState {
  return defaultAdminAuthBoundaryState;
}

export function canRenderProtectedAdminContent(_state: AdminAuthBoundaryState): false {
  return false;
}

export function describeAdminAuthBoundaryState(state: AdminAuthBoundaryState): string {
  switch (state.kind) {
    case "not_configured":
      return "Admin access is not configured yet.";
    case "authority_required":
      return "Admin access requires a future authority-backed auth/session milestone.";
    case "blocked":
      return describeBlockReason(state.reason);
  }
}

function describeBlockReason(reason: AdminAuthBlockReason): string {
  switch (reason) {
    case "real_auth_not_implemented":
      return "Real admin auth/session is not implemented.";
    case "authority_required_before_business_admin_features":
      return "Business admin features require explicit future authority.";
    case "configuration_missing":
      return "Required admin auth/session configuration is missing.";
  }
}
