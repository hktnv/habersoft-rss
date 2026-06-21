import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "main-service-release-packaging-"));
const envFile = path.join(tempRoot, "production-smoke.env");
const packageDir = path.join(tempRoot, "package");
const masterDirArgs = process.env.MASTER_DIR === undefined ? [] : ["--master-dir", process.env.MASTER_DIR];

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
  run("node", [
    "scripts/release-package.mjs",
    "--platform",
    "linux/amd64",
    "--output",
    packageDir,
    "--no-image",
    "true",
    "--allow-dirty",
    "true",
    ...masterDirArgs
  ]);
  run("node", ["scripts/release-package-verify.mjs", "--package", packageDir, "--allow-no-image", "true"]);
  expectFailure(["scripts/release-package-verify.mjs", "--package", packageDir], "missing image artifact");

  const tamperDir = clonePackage("tamper");
  writeFileSync(path.join(tamperDir, "manifest.json"), "{}\n");
  expectFailure(["scripts/release-package-verify.mjs", "--package", tamperDir, "--allow-no-image", "true"], "tamper");

  const wrongHashDir = clonePackage("wrong-hash");
  mutateJson(wrongHashDir, "manifest.json", (manifest) => {
    manifest.master_sha256 = "def24246ee3fe2f3feabee35e3c658216899d343d21b32637622271bc74d8e50";
  });
  expectFailure(["scripts/release-package-verify.mjs", "--package", wrongHashDir, "--allow-no-image", "true"], "wrong master hash");

  const wrongCountDir = clonePackage("wrong-count");
  mutateJson(wrongCountDir, "manifest.json", (manifest) => {
    manifest.master_active_markdown_count = 28;
  });
  expectFailure(["scripts/release-package-verify.mjs", "--package", wrongCountDir, "--allow-no-image", "true"], "wrong master count");

  const wrongSourceDir = clonePackage("wrong-source");
  mutateJson(wrongSourceDir, "metadata/provenance.json", (provenance) => {
    provenance.source_commit = "0000000000000000000000000000000000000000";
  });
  expectFailure(["scripts/release-package-verify.mjs", "--package", wrongSourceDir, "--allow-no-image", "true"], "wrong source commit");

  const malformedSbomDir = clonePackage("malformed-sbom");
  writeFileSync(path.join(malformedSbomDir, "metadata", "sbom.cdx.json"), "{}\n");
  rewriteChecksums(malformedSbomDir);
  expectFailure(["scripts/release-package-verify.mjs", "--package", malformedSbomDir, "--allow-no-image", "true"], "malformed SBOM");

  const falseAttestationDir = clonePackage("false-attestation");
  mutateJson(falseAttestationDir, "metadata/provenance.json", (provenance) => {
    provenance.signed_attestation = true;
  });
  expectFailure(["scripts/release-package-verify.mjs", "--package", falseAttestationDir, "--allow-no-image", "true"], "false signed attestation");
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

function expectFailure(args, label) {
  const result = spawnSync("node", args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status === 0) {
    throw new Error(`${label} verification unexpectedly passed`);
  }
  console.log(`test-release-packaging: ${label} negative test ok`);
}

function clonePackage(name) {
  const destination = path.join(tempRoot, name);
  cpSync(packageDir, destination, { recursive: true });
  return destination;
}

function mutateJson(directory, relativePath, mutate) {
  const file = path.join(directory, relativePath);
  const value = JSON.parse(readFileSync(file, "utf8"));
  mutate(value);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  rewriteChecksums(directory);
}

function rewriteChecksums(directory) {
  const files = collectFiles(directory)
    .filter((file) => path.basename(file) !== "checksums.sha256")
    .sort();
  const lines = files.map((file) => {
    const relative = path.relative(directory, file).replaceAll(path.sep, "/");
    const digest = crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${digest}  ${relative}`;
  });
  writeFileSync(path.join(directory, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return entry.isFile() ? [fullPath] : [];
  });
}
