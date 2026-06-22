import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const RELEASE_IDENTITY = Object.freeze({
  application: "main-service",
  version: "0.1.0-ms-017",
  status: "Staging Adayi",
  masterRelease: "rss-habersoft-master-v12",
  masterSha256: "df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430",
  masterActiveMarkdownCount: 29,
  productionDeployed: false,
  releasePublished: false
});

export const EXPECTED_SERVICES = Object.freeze(["postgres", "redis", "migrate", "main-service-api", "main-service-worker"]);

export const EXPECTED_PUBLIC_ROUTES = Object.freeze([
  "GET /health/live",
  "GET /health/ready",
  "POST /api/feeds",
  "GET /api/feeds",
  "DELETE /api/feeds/{feed_id}",
  "GET /api/entries",
  "GET /api/entries/{id}/detail",
  "POST /agent/heartbeat",
  "GET /agent/feeds/due",
  "POST /agent/feeds/{feed_id}/new-guids",
  "POST /agent/entries",
  "POST /agent/feed-check-results"
]);

export const EXPECTED_MIGRATIONS = Object.freeze([
  "20260620000000_initial_empty",
  "20260620001000_canonical_business_schema"
]);

export function defaultMasterDir(root = process.cwd()) {
  return path.resolve(root, "..", ".md", "master");
}

export function collectMasterInventory(masterDir = defaultMasterDir()) {
  return readdirSync(masterDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const absolutePath = path.join(masterDir, entry.name);
      const content = readFileSync(absolutePath);
      const relativePath = `.md/master/${entry.name}`;
      return {
        name: entry.name,
        absolutePath,
        relativePath,
        bytes: content,
        sha256: sha256(content),
        hasUtf8Bom: content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf,
        lineEndings: describeLineEndings(content)
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function computeMasterTreeHash(masterDir = defaultMasterDir()) {
  const inventory = collectMasterInventory(masterDir);
  const hash = createHash("sha256");
  for (const file of inventory) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.bytes);
    hash.update("\0", "utf8");
  }

  return {
    count: inventory.length,
    firstPath: inventory[0]?.relativePath,
    lastPath: inventory.at(-1)?.relativePath,
    sha256: hash.digest("hex"),
    inventory
  };
}

export function verifyMasterBaseline(masterDir = defaultMasterDir()) {
  const result = computeMasterTreeHash(masterDir);
  const failures = [];
  if (result.count !== RELEASE_IDENTITY.masterActiveMarkdownCount) {
    failures.push(`active master Markdown count ${result.count} != ${RELEASE_IDENTITY.masterActiveMarkdownCount}`);
  }
  if (result.sha256 !== RELEASE_IDENTITY.masterSha256) {
    failures.push(`active master SHA-256 ${result.sha256} != ${RELEASE_IDENTITY.masterSha256}`);
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return result;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function describeLineEndings(buffer) {
  const text = buffer.toString("utf8");
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const bareLf = (text.match(/(?<!\r)\n/gu) ?? []).length;
  const bareCr = (text.match(/\r(?!\n)/gu) ?? []).length;
  if (crlf === 0 && bareLf === 0 && bareCr === 0) {
    return "none";
  }
  return `crlf=${crlf},lf=${bareLf},cr=${bareCr}`;
}
