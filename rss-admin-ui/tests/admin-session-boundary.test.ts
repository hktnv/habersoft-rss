import { describe, expect, it } from "vitest";
import {
  adminAuthBoundaryContract,
  canRenderProtectedAdminContent,
  defaultAdminAuthBoundaryState,
  describeAdminAuthBoundaryState,
  futureAdminAuthorityRequirements,
  resolveAdminAuthBoundaryState,
  type AdminAuthBoundaryState
} from "../src/auth/adminSessionBoundary";

describe("admin auth/session boundary", () => {
  it("defaults to not configured and never authenticated", () => {
    expect(resolveAdminAuthBoundaryState()).toEqual({ kind: "not_configured" });
    expect(defaultAdminAuthBoundaryState.kind).toBe("not_configured");
    expect(JSON.stringify(resolveAdminAuthBoundaryState())).not.toMatch(/authenticated/i);
  });

  it("does not allow protected admin content for any current boundary state", () => {
    const states: AdminAuthBoundaryState[] = [
      { kind: "not_configured" },
      { kind: "authority_required", requirements: futureAdminAuthorityRequirements },
      { kind: "blocked", reason: "real_auth_not_implemented" },
      { kind: "blocked", reason: "authority_required_before_business_admin_features" },
      { kind: "blocked", reason: "configuration_missing" }
    ];

    for (const state of states) {
      expect(canRenderProtectedAdminContent(state)).toBe(false);
      expect(describeAdminAuthBoundaryState(state)).not.toMatch(/welcome|tenant|feed count|admin@example/i);
    }
  });

  it("records future authority blockers without implementing credential flow", () => {
    expect(futureAdminAuthorityRequirements).toEqual([
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
    ]);
    expect(adminAuthBoundaryContract).toMatchObject({
      statusDashboardPublic: true,
      protectedAdminShellPresent: true,
      realAuthImplemented: false,
      defaultAllowsProtectedContent: false,
      browserCredentialExchangeImplemented: false,
      browserCredentialPersistenceImplemented: false,
      fakeAdminIdentityAllowed: false,
      privilegedBusinessDataAllowed: false,
      adminApiWritesImplemented: false,
      futureAuthorityRequired: true
    });
  });
});
