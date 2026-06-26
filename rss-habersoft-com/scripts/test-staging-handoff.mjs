import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EXPECTED_MIGRATIONS, EXPECTED_PUBLIC_ROUTES, EXPECTED_SERVICES, RELEASE_IDENTITY } from "./release-identity.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-staging-handoff-tests-"));
const checksumFiles = [
  "environment-marker-instructions.md",
  "handoff-manifest.json",
  "host-requirements.json",
  "known-hosts-instructions.md",
  "local-rehearsal-evidence.json",
  "operator-checklist.md",
  "package-handoff-requirements.json",
  "staging-target.template.json",
  "staging.env.template"
];
const payloadFiles = checksumFiles.filter((file) => file !== "handoff-manifest.json");

try {
  const bundle = generateBundle("valid");
  assertVerifyPasses(bundle);

  const manifest = readJson(path.join(bundle, "handoff-manifest.json"));
  assert.equal(manifest.application_version, RELEASE_IDENTITY.version);
  assert.equal(manifest.master_hash, RELEASE_IDENTITY.masterSha256);
  assert.equal(manifest.safety_flags.ssh_contacted, false);
  assert.equal(manifest.safety_flags.remote_mutation_performed, false);

  const host = readJson(path.join(bundle, "host-requirements.json"));
  assert.equal(host.required_platform, "linux/amd64");
  assert.equal(host.docker_compose_v2_required, true);
  assert.equal(host.api_binding, "loopback-only");
  assert.equal(host.public_database_port_allowed, false);
  assert.equal(host.public_redis_port_allowed, false);
  assert.equal(host.public_worker_port_allowed, false);
  assert.equal(host.capacity_model.cpu_ram_not_invented, true);
  assert.equal(host.capacity_model.ha_claimed, false);
  assert.deepEqual(host.compose_services, EXPECTED_SERVICES);

  const target = readJson(path.join(bundle, "staging-target.template.json"));
  assert.equal(target.approved, false);
  assert.equal(target.ssh_host, "OPERATOR_REPLACE_WITH_NON_PRODUCTION_STAGING_HOST");
  assert.equal(target.ssh_user, "OPERATOR_REPLACE_WITH_DEPLOY_USER");
  assert.equal(target.known_hosts_file, "OPERATOR_REPLACE_WITH_EXTERNAL_PINNED_KNOWN_HOSTS_FILE");

  const packageRequirements = readJson(path.join(bundle, "package-handoff-requirements.json"));
  assert.equal(packageRequirements.deployable_artifact_included, false);
  assert.deepEqual(packageRequirements.expected_public_routes, EXPECTED_PUBLIC_ROUTES);
  assert.deepEqual(packageRequirements.expected_migrations, EXPECTED_MIGRATIONS);

  const envTemplate = readFileSync(path.join(bundle, "staging.env.template"), "utf8");
  assert.match(envTemplate, /AGENT_KEY=<STAGING_AGENT_KEY_MINIMUM_32_BYTES>/u);
  assert.doesNotMatch(envTemplate, /rss\.habersoft\.com|BEGIN OPENSSH PRIVATE KEY|ssh-keyscan/u);

  const insideRepo = path.resolve(".tmp-staging-handoff-inside");
  const insideResult = runNode(generateArgs(insideRepo));
  assert.notEqual(insideResult.status, 0);
  assert.equal(existsSync(insideRepo), false);

  const nonEmpty = path.join(temp, "non-empty");
  mkdirSync(nonEmpty);
  writeFileSync(path.join(nonEmpty, "foreign.txt"), "not generated\n");
  assert.notEqual(runNode(generateArgs(nonEmpty)).status, 0);

  const checksumTamper = generateBundle("checksum-tamper");
  writeFileSync(path.join(checksumTamper, "known-hosts-instructions.md"), "tampered\n");
  assertVerifyFails(checksumTamper, /checksum mismatch/u);

  const missingFile = generateBundle("missing-file");
  rmSync(path.join(missingFile, "operator-checklist.md"));
  assertVerifyFails(missingFile, /bundle file inventory/u);

  const secretBundle = generateBundle("secret");
  writeFileSync(
    path.join(secretBundle, "staging.env.template"),
    readFileSync(path.join(secretBundle, "staging.env.template"), "utf8").replace("<STAGING_AGENT_KEY_MINIMUM_32_BYTES>", "a".repeat(40))
  );
  refreshManifestAndChecksums(secretBundle);
  assertVerifyFails(secretBundle, /AGENT_KEY must be placeholder/u);

  const privateKeyBundle = generateBundle("private-key");
  appendText(privateKeyBundle, "known-hosts-instructions.md", "\n-----BEGIN OPENSSH PRIVATE KEY-----\n");
  refreshManifestAndChecksums(privateKeyBundle);
  assertVerifyFails(privateKeyBundle, /private key pattern/u);

  const hostIpBundle = generateBundle("host-ip");
  appendText(hostIpBundle, "operator-checklist.md", "\nDo not use 203.0.113.10 here.\n");
  refreshManifestAndChecksums(hostIpBundle);
  assertVerifyFails(hostIpBundle, /IP address pattern/u);

  const knownHostsKeyBundle = generateBundle("known-hosts-key");
  appendText(knownHostsKeyBundle, "known-hosts-instructions.md", `\noperator-host ssh-ed25519 ${"A".repeat(80)}\n`);
  refreshManifestAndChecksums(knownHostsKeyBundle);
  assertVerifyFails(knownHostsKeyBundle, /known_hosts key line/u);

  const approvedBundle = generateBundle("approved");
  const approvedTarget = readJson(path.join(approvedBundle, "staging-target.template.json"));
  approvedTarget.approved = true;
  writeJson(path.join(approvedBundle, "staging-target.template.json"), approvedTarget);
  refreshManifestAndChecksums(approvedBundle);
  assertVerifyFails(approvedBundle, /approved=false/u);

  const remoteDeploymentBundle = generateBundle("remote-deployment");
  const remoteHost = readJson(path.join(remoteDeploymentBundle, "host-requirements.json"));
  remoteHost.remote_deployment_performed = true;
  writeJson(path.join(remoteDeploymentBundle, "host-requirements.json"), remoteHost);
  refreshManifestAndChecksums(remoteDeploymentBundle);
  assertVerifyFails(remoteDeploymentBundle, /remote deployment must be false/u);

  const archiveBundle = generateBundle("archive");
  writeFileSync(path.join(archiveBundle, "main-service-image.tar"), "not a handoff file\n");
  assertVerifyFails(archiveBundle, /bundle file inventory/u);

  const traversalBundle = generateBundle("path-traversal");
  const traversalTarget = readJson(path.join(traversalBundle, "staging-target.template.json"));
  traversalTarget.remote_base_dir = "/opt/habersoft/../rss-main-service-staging";
  writeJson(path.join(traversalBundle, "staging-target.template.json"), traversalTarget);
  refreshManifestAndChecksums(traversalBundle);
  assertVerifyFails(traversalBundle, /remote base dir mismatch|traversal/u);

  console.log("test-staging-handoff: ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function generateBundle(label) {
  const outputDir = path.join(temp, label);
  const result = runNode(generateArgs(outputDir));
  assert.equal(result.status, 0, result.stderr);
  return outputDir;
}

function generateArgs(outputDir) {
  return [
    "scripts/staging-operator-handoff.mjs",
    "generate",
    "--output-dir",
    outputDir,
    "--platform",
    "linux/amd64",
    "--edge-mode",
    "loopback-only",
    "--marker-path",
    "/etc/habersoft/environment",
    "--remote-base-dir",
    "/opt/habersoft/rss-main-service-staging",
    "--project-name",
    "habersoft-rss-staging",
    "--api-port",
    "13000"
  ];
}

function assertVerifyPasses(bundle) {
  const result = runNode(["scripts/staging-operator-handoff.mjs", "verify", "--bundle", bundle]);
  assert.equal(result.status, 0, result.stderr);
}

function assertVerifyFails(bundle, pattern) {
  const result = runNode(["scripts/staging-operator-handoff.mjs", "verify", "--bundle", bundle]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

function refreshManifestAndChecksums(bundle) {
  const manifestFile = path.join(bundle, "handoff-manifest.json");
  const manifest = readJson(manifestFile);
  manifest.payload_files = payloadFiles.map((file) => fileMetadata(bundle, file));
  writeJson(manifestFile, manifest);
  const lines = checksumFiles.map((file) => `${sha256(readFileSync(path.join(bundle, file)))}  ${file}`);
  writeFileSync(path.join(bundle, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function fileMetadata(bundle, file) {
  const fullPath = path.join(bundle, file);
  return {
    path: file,
    sha256: sha256(readFileSync(fullPath)),
    bytes: statSync(fullPath).size
  };
}

function appendText(bundle, file, text) {
  writeFileSync(path.join(bundle, file), `${readFileSync(path.join(bundle, file), "utf8")}${text}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
}
