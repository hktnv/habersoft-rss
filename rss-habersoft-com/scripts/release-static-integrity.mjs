import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  EXPECTED_MIGRATIONS,
  RELEASE_IDENTITY
} from "./release-identity.mjs";

const root = process.cwd();
const expectedVersion = RELEASE_IDENTITY.version;
const failures = [];
const nonCanonicalMasterHash = "def24246ee3fe2f3feabee35e3c658216899d343d21b32637622271bc74d8e50";

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

const packageJson = JSON.parse(read("package.json"));
const composeYaml = read("compose.yaml");
const productionComposeYaml = read("deploy/production/compose.yaml");
const productionTemplate = read("deploy/production/production.env.template");
const prodDocsText = collectFiles(path.join(root, ".docs"), ".md")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const registry = read("src/maintenance/maintenance.registry.ts");
const sourceText = collectFiles(path.join(root, "src"), ".ts")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

assert(packageJson.version === expectedVersion, `package.json version must be ${expectedVersion}`);
assert(packageJson.dependencies?.bullmq === "5.79.0", "bullmq must remain pinned to 5.79.0");
assert(packageJson.dependencies?.["@nestjs/bullmq"] === "11.0.4", "@nestjs/bullmq must remain pinned to 11.0.4");
assert(composeYaml.includes(`main-service-app:${expectedVersion}`), `compose image tag must be ${expectedVersion}`);
assert(productionComposeYaml.includes("${MAIN_SERVICE_IMAGE:?MAIN_SERVICE_IMAGE is required and must be digest-pinned}"), "production Compose must use externally supplied immutable image");
assert(!productionTemplate.includes("MAIN_SERVICE_IMAGE="), "production env template must not own MAIN_SERVICE_IMAGE");
assert(!productionComposeYaml.includes("tenant-auth-jwks-fixture"), "production Compose must not include local JWKS fixture");
assert(!/\bbuild\s*:/u.test(productionComposeYaml), "production Compose must not build from source");
assert(productionComposeYaml.includes("127.0.0.1:${API_HOST_PORT"), "production API must bind to loopback");
assert(!/5432:5432|6379:6379/u.test(productionComposeYaml), "production Compose must not publish PostgreSQL or Redis ports");
assert(productionTemplate.includes("TENANT_AUTH_JWKS_URL=https://auth.habersoft.com/.well-known/jwks.json"), "production env template must use HTTPS JWKS placeholder");
assert(prodDocsText.includes(RELEASE_IDENTITY.masterSha256), "repo-local docs must include canonical master v12 hash");
assert(!prodDocsText.includes(nonCanonicalMasterHash), "repo-local docs must not include non-canonical master hash");
assert(read("scripts/release-package.mjs").includes("verifyMasterBaseline"), "release package must verify active master baseline");
assert(read("scripts/release-package.mjs").includes("runtime_image_env"), "release package must include runtime image env metadata");
assert(read("scripts/release-package-verify.mjs").includes("verifySbom"), "release package verifier must validate SBOM structure");
assert(read("scripts/release-package-verify.mjs").includes("verifyRuntimeImageEnv"), "release package verifier must validate runtime image env");
assert(read("scripts/release-package-verify.mjs").includes("signed_attestation === false"), "release package verifier must reject false signed attestation claims");
assert(registry.includes('MAINTENANCE_QUEUE_NAME = "main-service.maintenance"'), "maintenance queue registry mismatch");
assert(registry.includes('CLEANUP_RUN_JOB_NAME = "cleanup.run.v1"'), "cleanup job registry mismatch");
assert(registry.includes('CLEANUP_DAILY_SCHEDULER_ID = "cleanup.daily"'), "cleanup scheduler registry mismatch");
assert(registry.includes('CLEANUP_DAILY_CRON_PATTERN = "0 3 * * *"'), "cleanup cron registry mismatch");
assert(registry.includes('CLEANUP_DAILY_TIMEZONE = "UTC"'), "cleanup timezone registry mismatch");
assert(registry.includes("MAINTENANCE_GLOBAL_CONCURRENCY = 1"), "global concurrency registry mismatch");
assert(registry.includes("MAINTENANCE_WORKER_CONCURRENCY = 1"), "worker concurrency registry mismatch");
assert(!sourceText.includes("$queryRawUnsafe"), "unsafe Prisma query raw usage is not allowed");
assert(!sourceText.includes("$executeRawUnsafe"), "unsafe Prisma execute raw usage is not allowed");
assert(!sourceText.includes("QueueScheduler"), "legacy BullMQ QueueScheduler is not allowed");
assert(!sourceText.includes("FlowProducer"), "BullMQ FlowProducer is outside MS-015 scope");
assert(!sourceText.includes("@nestjs/schedule"), "Nest schedule is outside MS-015 scope");

const migrations = readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert(JSON.stringify(migrations) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release-static-integrity: ${failure}`);
  }
  process.exit(1);
}

console.log("release-static-integrity: ok");

function collectFiles(directory, extension) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath, extension);
    }

    return entry.isFile() && entry.name.endsWith(extension) ? [fullPath] : [];
  });
}
