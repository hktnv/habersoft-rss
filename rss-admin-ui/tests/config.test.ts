import { describe, expect, it } from "vitest";
import { adminUiConfigContract, normalizeApiBaseUrl, resolveAdminUiConfig } from "../src/config/adminUiConfig";

describe("admin UI config adapter", () => {
  it("resolves a safe local API base by default", () => {
    delete window.__RSS_ADMIN_UI_CONFIG__;

    expect(resolveAdminUiConfig().apiBaseUrl).toBe("http://localhost:3000");
  });

  it("normalizes absolute HTTP(S) URLs", () => {
    expect(normalizeApiBaseUrl("https://rss.habersoft.com/api/")).toBe("https://rss.habersoft.com/api");
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeApiBaseUrl("file:///tmp/config")).toThrow(/HTTP/);
  });

  it("keeps auth and write behaviors out of scope", () => {
    expect(adminUiConfigContract.agentKeyAllowed).toBe(false);
    expect(adminUiConfigContract.writesImplemented).toBe(false);
    expect(adminUiConfigContract.tokenPersistenceImplemented).toBe(false);
  });
});
