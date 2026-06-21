import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const expectedVersion = "0.1.0-ms-015";
const expectedMigrations = ["20260620000000_initial_empty", "20260620001000_canonical_business_schema"];
const failures = [];

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
const registry = read("src/maintenance/maintenance.registry.ts");
const sourceText = collectFiles(path.join(root, "src"), ".ts")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

assert(packageJson.version === expectedVersion, `package.json version must be ${expectedVersion}`);
assert(packageJson.dependencies?.bullmq === "5.79.0", "bullmq must remain pinned to 5.79.0");
assert(packageJson.dependencies?.["@nestjs/bullmq"] === "11.0.4", "@nestjs/bullmq must remain pinned to 11.0.4");
assert(composeYaml.includes(`main-service-app:${expectedVersion}`), `compose image tag must be ${expectedVersion}`);
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
assert(JSON.stringify(migrations) === JSON.stringify(expectedMigrations), "migration inventory mismatch");

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
