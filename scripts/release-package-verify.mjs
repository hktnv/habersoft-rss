import { readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const packagePath = args.package;

if (packagePath === undefined) {
  fail("release:package:verify requires --package <directory>");
}

const root = path.resolve(packagePath);
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const failures = [];

assert(manifest.application === "main-service", "manifest application mismatch");
assert(manifest.version === "0.1.0-ms-016", "manifest version mismatch");
assert(manifest.master_release === "rss-habersoft-master-v12", "manifest master release mismatch");
assert(manifest.master_sha256 === "df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430", "manifest master hash mismatch");
assert(manifest.production_deployed === false, "manifest must not claim production deployment");
assert(manifest.release_published === false, "manifest must not claim release publication");
assert(JSON.stringify(manifest.services) === JSON.stringify(["postgres", "redis", "migrate", "main-service-api", "main-service-worker"]), "service inventory mismatch");
assert(JSON.stringify(manifest.migrations) === JSON.stringify(["20260620000000_initial_empty", "20260620001000_canonical_business_schema"]), "migration inventory mismatch");

verifyChecksums(root);
scanPackage(root);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release-package-verify: ${failure}`);
  }
  process.exit(1);
}

console.log("release-package-verify: ok");

function verifyChecksums(directory) {
  const checksumFile = path.join(directory, "checksums.sha256");
  const lines = readFileSync(checksumFile, "utf8").trim().split(/\r?\n/u);
  for (const line of lines) {
    const [expected, relative] = line.split(/\s\s/u);
    const file = path.join(directory, relative);
    const actual = sha256(readFileSync(file));
    assert(actual === expected, `checksum mismatch for ${relative}`);
  }
}

function scanPackage(directory) {
  const forbiddenNames = new Set([".env.production", "config.json"]);
  for (const file of collectFiles(directory)) {
    const relative = path.relative(directory, file).replaceAll(path.sep, "/");
    const basename = path.basename(file);
    assert(!forbiddenNames.has(basename), `forbidden file in package: ${relative}`);
    if (relative.endsWith(".tar")) {
      continue;
    }

    const text = readFileSync(file, "utf8");
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/u.test(text), `private key pattern in ${relative}`);
    assert(!/AKIA[0-9A-Z]{16}/u.test(text), `AWS key pattern in ${relative}`);
    assert(!/Bearer [A-Za-z0-9._-]+/u.test(text), `bearer token pattern in ${relative}`);
    assert(!/postgres(ql)?:\/\/[^:\s]+:[^@\s]+@[^/\s]+/u.test(text) || relative.endsWith(".template"), `database credential URL in ${relative}`);
  }
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

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    result[arg.slice(2)] = rawArgs[index + 1];
    index += 1;
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
