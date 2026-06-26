import { createTenantPrincipal } from "../../src/tenant-auth/tenant-principal";

describe("createTenantPrincipal", () => {
  it("creates an immutable tenant principal", () => {
    const principal = createTenantPrincipal({
      subject: "site-a",
      scopes: ["services:access"],
      tokenId: "jwt-1"
    });

    expect(principal).toMatchObject({
      siteClientId: "site-a",
      subject: "site-a",
      tokenId: "jwt-1"
    });
    expect(principal.scopes.has("services:access")).toBe(true);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal.scopes)).toBe(true);
    expect("add" in principal.scopes).toBe(false);
  });
});
