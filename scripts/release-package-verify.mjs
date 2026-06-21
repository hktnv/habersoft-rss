import { existsSync, readFileSync, readdirSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_PUBLIC_ROUTES,
  EXPECTED_SERVICES,
  RELEASE_IDENTITY
} from "./release-identity.mjs";

const args = parseArgs(process.argv.slice(2));
const packagePath = args.package;
const allowNoImage = args["allow-no-image"] === "true";
const expectedSourceCommit = args["source-commit"];

if (packagePath === undefined) {
  fail("release:package:verify requires --package <directory>");
}

const root = path.resolve(packagePath);
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const failures = [];

assert(manifest.application === RELEASE_IDENTITY.application, "manifest application mismatch");
assert(manifest.version === RELEASE_IDENTITY.version, "manifest version mismatch");
assert(manifest.master_release === RELEASE_IDENTITY.masterRelease, "manifest master release mismatch");
assert(manifest.master_sha256 === RELEASE_IDENTITY.masterSha256, "manifest master hash mismatch");
assert(manifest.master_active_markdown_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "manifest master active count mismatch");
assert(manifest.production_deployed === false, "manifest must not claim production deployment");
assert(manifest.release_published === false, "manifest must not claim release publication");
assert(/^([a-f0-9]{40})$/u.test(manifest.source_commit), "manifest source commit must be a full git SHA-1");
if (expectedSourceCommit !== undefined) {
  assert(manifest.source_commit === expectedSourceCommit, "manifest source commit does not match expected source commit");
}
assert(JSON.stringify(manifest.services) === JSON.stringify(EXPECTED_SERVICES), "service inventory mismatch");
assert(JSON.stringify(manifest.public_routes) === JSON.stringify(EXPECTED_PUBLIC_ROUTES), "public route inventory mismatch");
assert(JSON.stringify(manifest.migrations) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");
assert(manifest.provenance_level === "local metadata", "manifest provenance level mismatch");
assert(manifest.attestation_level === "unsigned provenance", "manifest attestation level mismatch");

verifyChecksums(root);
verifyImage(root, manifest);
verifySbom(root, manifest);
verifyProvenance(root, manifest);
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

function verifyImage(directory, manifest) {
  const imageTar = path.join(directory, "main-service-image.tar");
  const hasImageTar = existsSync(imageTar);
  if (!allowNoImage) {
    assert(manifest.image?.included === true, "image artifact must be included");
    assert(hasImageTar, "main-service-image.tar is required");
  }
  if (manifest.image?.included === true) {
    assert(hasImageTar, "manifest claims included image but image tar is missing");
    assert(/^sha256:[a-f0-9]{64}$/u.test(manifest.image.id ?? ""), "included image id must be a sha256 digest");
  }
}

function verifySbom(directory, manifest) {
  const sbom = JSON.parse(readFileSync(path.join(directory, "metadata", "sbom.cdx.json"), "utf8"));
  const components = Array.isArray(sbom.components) ? sbom.components : [];
  assert(sbom.bomFormat === "CycloneDX", "SBOM bomFormat must be CycloneDX");
  assert(sbom.specVersion === "1.5", "SBOM specVersion must be 1.5");
  assert(sbom.metadata?.component?.name === RELEASE_IDENTITY.application, "SBOM application component name mismatch");
  assert(sbom.metadata?.component?.version === RELEASE_IDENTITY.version, "SBOM application component version mismatch");
  assert(components.length > 0, "SBOM component inventory must not be empty");
  assert(manifest.sbom?.generator === "npm sbom --sbom-format=cyclonedx --json", "manifest SBOM generator mismatch");
  assert(manifest.sbom?.bom_format === "CycloneDX", "manifest SBOM format mismatch");
  assert(manifest.sbom?.spec_version === "1.5", "manifest SBOM spec version mismatch");
  assert(manifest.sbom?.component_count === components.length, "manifest SBOM component count mismatch");
  assert((sbom.metadata?.tools ?? []).some((tool) => tool.name === "cli" && tool.vendor === "npm"), "SBOM npm generator metadata missing");
}

function verifyProvenance(directory, manifest) {
  const provenance = JSON.parse(readFileSync(path.join(directory, "metadata", "provenance.json"), "utf8"));
  assert(provenance.schema_version === 1, "provenance schema version mismatch");
  assert(provenance.application === RELEASE_IDENTITY.application, "provenance application mismatch");
  assert(provenance.version === RELEASE_IDENTITY.version, "provenance version mismatch");
  assert(provenance.source_commit === manifest.source_commit, "provenance source commit mismatch");
  assert(provenance.master_release === RELEASE_IDENTITY.masterRelease, "provenance master release mismatch");
  assert(provenance.master_sha256 === RELEASE_IDENTITY.masterSha256, "provenance master hash mismatch");
  assert(provenance.master_active_markdown_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "provenance master active count mismatch");
  assert(provenance.provenance_level === "local metadata", "provenance level mismatch");
  assert(provenance.attestation_level === "unsigned provenance", "attestation level mismatch");
  assert(provenance.external_registry_push === false, "provenance must not claim external registry push");
  assert(provenance.git_tag_created === false, "provenance must not claim Git tag");
  assert(provenance.github_release_created === false, "provenance must not claim GitHub Release");
  assert(provenance.staging_deployed === false, "provenance must not claim staging deployment");
  assert(provenance.production_deployed === false, "provenance must not claim production deployment");
  assert(provenance.buildkit_attestation === false, "provenance must not claim BuildKit attestation");
  assert(provenance.signed_attestation === false, "provenance must not claim signed attestation");
  assert(JSON.stringify(provenance.sbom) === JSON.stringify(manifest.sbom), "provenance SBOM summary mismatch");
  assert(JSON.stringify(provenance.image) === JSON.stringify(manifest.image), "provenance image identity mismatch");
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
