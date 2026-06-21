import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "main-service-release-packaging-"));
const envFile = path.join(tempRoot, "production-smoke.env");
const packageDir = path.join(tempRoot, "package");

writeFileSync(
  envFile,
  [
    "MAIN_SERVICE_IMAGE=registry.example.invalid/rss/main-service@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "LOG_LEVEL=info",
    "API_HOST_PORT=31016",
    "POSTGRES_USER=main_service",
    "POSTGRES_PASSWORD=production_password_minimum_32_bytes",
    "POSTGRES_DB=main_service",
    "DATABASE_URL=postgresql://main_service:production_password_minimum_32_bytes@postgres:5432/main_service?schema=public",
    "REDIS_URL=redis://redis:6379/0",
    "TENANT_AUTH_JWKS_URL=https://auth.habersoft.com/.well-known/jwks.json",
    "TENANT_RATE_LIMIT_MAX_REQUESTS=60",
    "TENANT_RATE_LIMIT_WINDOW_SECONDS=60",
    "TENANT_RATE_LIMIT_REDIS_PREFIX=tenant_rate_limit:production",
    "TENANT_RATE_LIMIT_KEY_SECRET=production_rate_limit_secret_32_bytes",
    "AGENT_KEY=production_agent_key_minimum_32_bytes",
    "CHECKED_AT_MAX_FUTURE_SKEW_SECONDS=60",
    "CHECKED_AT_MAX_AGE_SECONDS=900",
    "ENTRY_RETENTION_DAYS=30",
    "ENTRY_MAX_PER_FEED=10000",
    "ENTRY_DETAIL_RETENTION_DAYS=7",
    "ENTRY_DETAIL_MAX_PER_FEED=2000",
    "BULLMQ_PREFIX=main-service-production",
    "MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS=604800",
    "MAINTENANCE_COMPLETED_JOB_MAX_COUNT=1000",
    "MAINTENANCE_FAILED_JOB_RETENTION_SECONDS=2592000",
    "MAINTENANCE_FAILED_JOB_MAX_COUNT=5000",
    ""
  ].join("\n")
);

try {
  run("node", ["scripts/production-config-check.mjs", "--env-file", envFile]);
  run("node", ["scripts/production-compose-verify.mjs", "--env-file", envFile]);
  run("node", ["scripts/release-package.mjs", "--platform", "linux/amd64", "--output", packageDir, "--no-image", "true"]);
  run("node", ["scripts/release-package-verify.mjs", "--package", packageDir]);

  writeFileSync(path.join(packageDir, "manifest.json"), "{}\n");
  const tamper = spawnSync("node", ["scripts/release-package-verify.mjs", "--package", packageDir], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (tamper.status === 0) {
    throw new Error("tamper verification unexpectedly passed");
  }
  console.log("test-release-packaging: tamper negative test ok");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("test-release-packaging: ok");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
