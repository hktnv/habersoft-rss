import { describe, expect, it } from "vitest";
import {
  adminUiConfigContract,
  normalizeApiBaseUrl,
  normalizeEnvironmentName,
  resolveAdminUiConfig
} from "../src/config/adminUiConfig";

describe("admin UI config adapter", () => {
  it("resolves a safe local API base by default", () => {
    delete window.__RSS_ADMIN_UI_CONFIG__;

    expect(resolveAdminUiConfig().apiBaseUrl).toBe("http://localhost:3000");
  });

  it("normalizes absolute HTTP(S) URLs", () => {
    expect(normalizeApiBaseUrl("https://api.example.test/api/")).toBe("https://api.example.test/api");
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeApiBaseUrl("file:///tmp/config")).toThrow(/HTTP/);
  });

  it("keeps environment labels bounded and non-secret", () => {
    expect(normalizeEnvironmentName(" local-admin ")).toBe("local-admin");
    expect(normalizeEnvironmentName("")).toBe("local");
    expect(() => normalizeEnvironmentName("https://api.example.test")).toThrow(/non-secret/);
    expect(() => normalizeEnvironmentName("Authorization Bearer token")).toThrow(/non-secret/);
  });

  it("keeps auth, persistence, and write behaviors out of scope", () => {
    expect(adminUiConfigContract.readOnlyHealthDashboardImplemented).toBe(true);
    expect(adminUiConfigContract.publicHealthObservationOnly).toBe(true);
    expect(adminUiConfigContract.agentKeyAllowed).toBe(false);
    expect(adminUiConfigContract.writesImplemented).toBe(false);
    expect(adminUiConfigContract.tokenPersistenceImplemented).toBe(false);
  });
});
