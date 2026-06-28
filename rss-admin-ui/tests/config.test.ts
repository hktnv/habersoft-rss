import { describe, expect, it } from "vitest";
import {
  adminUiConfigContract,
  normalizeEnvironmentName,
  resolveAdminUiConfig
} from "../src/config/adminUiConfig";

describe("admin UI config adapter", () => {
  it("resolves only a non-secret local environment label by default", () => {
    delete window.__RSS_ADMIN_UI_CONFIG__;

    expect(resolveAdminUiConfig()).toEqual({ environmentName: "test" });
  });

  it("keeps environment labels bounded and non-secret", () => {
    expect(normalizeEnvironmentName(" local-admin ")).toBe("local-admin");
    expect(normalizeEnvironmentName("")).toBe("local");
    expect(() => normalizeEnvironmentName("https://api.example.test")).toThrow(/non-secret/);
    expect(() => normalizeEnvironmentName("Authorization Bearer token")).toThrow(/non-secret/);
  });

  it("keeps auth, persistence, and write behaviors out of scope", () => {
    expect(adminUiConfigContract.readOnlyHealthDashboardImplemented).toBe(true);
    expect(adminUiConfigContract.sameOriginHealthTransport).toBe(true);
    expect(adminUiConfigContract.clientVisibleApiBaseUrl).toBe(false);
    expect(adminUiConfigContract.publicHealthObservationOnly).toBe(true);
    expect(adminUiConfigContract.agentKeyAllowed).toBe(false);
    expect(adminUiConfigContract.writesImplemented).toBe(false);
    expect(adminUiConfigContract.tokenPersistenceImplemented).toBe(false);
  });
});
