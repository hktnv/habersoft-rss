import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(path.join(root, ".docs", "production-activation-readiness.md"), "utf8");

describe("production activation readiness contract", () => {
  it("keeps MS-020D no-deploy status and residual blockers explicit", () => {
    for (const token of [
      "MS-020D_PRODUCTION_READINESS_PACKAGED_NO_DEPLOY",
      "PRODUCTION_MUTATION_NOT_PERFORMED",
      "ADMIN_UI_NOT_DEPLOYED",
      "AUTH_SESSION_DEFERRED",
      "NOT_DEPLOYED"
    ]) {
      expect(doc).toContain(token);
    }
  });

  it("classifies every current status-only field before public activation", () => {
    for (const field of [
      "Overall health state",
      "Live status",
      "Ready status",
      "Postgres dependency state",
      "Redis dependency state",
      "Tenant auth dependency state",
      "Environment label",
      "Last checked",
      "Safe error text"
    ]) {
      expect(doc).toContain(field);
    }
    expect(doc).toContain("AUTH_OR_REDACTION_REQUIRED_BEFORE_PRODUCTION");
  });

  it("pins exact health transport and future operator authority boundaries", () => {
    for (const required of [
      "ADMIN_UI_HEALTH_UPSTREAM_ORIGIN",
      "ADMIN_UI_API_BASE_URL",
      "/status-api/health/live",
      "/status-api/health/ready",
      "Set-Cookie",
      "WWW-Authenticate",
      "rss-panel.habersoft.com",
      "OPERATOR_AUTHORIZED_FUTURE_TASK_ONLY",
      "npm run verify:production-readiness"
    ]) {
      expect(doc).toContain(required);
    }
  });
});
