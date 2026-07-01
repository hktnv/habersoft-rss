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
import type { AdminSessionStatus } from "../src/auth/adminSessionClient";

describe("admin auth/session boundary", () => {
  it("defaults to same-origin session support without an authenticated default", () => {
    expect(resolveAdminAuthBoundaryState()).toEqual({ kind: "same_origin_session" });
    expect(defaultAdminAuthBoundaryState.kind).toBe("same_origin_session");
    expect(
      canRenderProtectedAdminContent(resolveAdminAuthBoundaryState(), {
        kind: "unauthenticated",
        message: "Admin authentication is required."
      })
    ).toBe(false);
  });

  it("allows protected admin content only for the authenticated session state", () => {
    const authenticated: AdminSessionStatus = {
      kind: "authenticated",
      message: "Admin session is authenticated.",
      principal: { kind: "single_admin", displayName: "Admin" },
      expiresAt: "2026-06-20T00:00:00.000Z",
      csrfToken
    };
    const states: AdminAuthBoundaryState[] = [
      { kind: "same_origin_session" },
      { kind: "not_configured" },
      { kind: "authority_required", requirements: futureAdminAuthorityRequirements },
      { kind: "blocked", reason: "admin_auth_not_configured" },
      { kind: "blocked", reason: "authority_required_before_business_admin_features" },
      { kind: "blocked", reason: "configuration_missing" }
    ];

    expect(canRenderProtectedAdminContent({ kind: "same_origin_session" }, authenticated)).toBe(true);
    for (const state of states.slice(1)) {
      expect(canRenderProtectedAdminContent(state, authenticated)).toBe(false);
      expect(describeAdminAuthBoundaryState(state)).not.toMatch(/tenant id|feed count|admin@example/i);
    }
  });

  it("records implemented auth/session transport and remaining future authority blockers", () => {
    expect(futureAdminAuthorityRequirements).toEqual([
      "csrf_xss_stance",
      "tenant_admin_identity_boundary",
      "role_permission_model",
      "authenticated_field_classification",
      "backend_route_inventory",
      "production_activation_evidence",
      "production_secret_provisioning"
    ]);
    expect(adminAuthBoundaryContract).toMatchObject({
      statusDashboardPublic: false,
      protectedAdminShellPresent: true,
      realAuthImplemented: true,
      defaultAllowsProtectedContent: false,
      browserCredentialExchangeImplemented: true,
      browserCredentialPersistenceImplemented: false,
      fakeAdminIdentityAllowed: false,
      privilegedBusinessDataAllowed: false,
      adminApiWritesImplemented: "bounded_feed_recheck_request_only",
      futureAuthorityRequiredBeforeBusinessAdminFeatures: true
    });
  });
});

const csrfToken = "csrf_token_value_at_least_32_characters";
