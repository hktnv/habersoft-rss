import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-ms019c-tests-"));
const fakeBin = path.join(temp, "fake-bin");
const captureDir = path.join(temp, "capture-output");
const restoreReceipt = path.join(temp, "off-host-restore-receipt.json");
const combinedReceipt = path.join(temp, "production-backup-restore-receipt.json");
const handoffDir = path.join(temp, "handoff");
const freezeFile = path.join(temp, "handoff-freeze.json");
const stagingBackupSha = "595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc";

try {
  mkdirSync(fakeBin, { recursive: true });
  writeFakeDocker(fakeBin);
  const env = writeCaptureFixture();

  assertHandoffPasses();
  assertCapturePasses(env);
  assertRestorePasses();
  assertCombinedReceiptPasses();

  assertCaptureRejectsNonEmptyOutput(env);
  assertRestoreRejectsPlainSql();
  assertRestoreRejectsChecksumMismatch();
  assertRestoreRejectsSecretMetadata();
  assertRestoreRejectsRemoteDockerContext();
  assertRestoreRejectsTeardownLeak();
  assertCombinedReceiptRejectsStagingBackupSha();
  assertCombinedReceiptStrictRejectsFailedBaseline();
  assertHandoffRejectsChecksumMismatch();
  assertHandoffRejectsCrlfShell();
  assertHandoffRejectsForbiddenShellCommand();

  console.log("test-production-backup-restore-evidence: ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assertHandoffPasses() {
  const generate = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff", "--output", handoffDir]);
  assert.equal(generate.status, 0, generate.stderr);
  assert.deepEqual(readdirSync(handoffDir).sort(), [
    "README.md",
    "backup-restore-contract.json",
    "capture-production-postgres-backup.sh",
    "checksums.sha256",
    "manifest.json",
    "verify-off-host-postgres-restore.sh"
  ].sort());
  assert.equal(readFileSync(path.join(handoffDir, "capture-production-postgres-backup.sh")).includes(13), false);
  assert.equal(spawnSync("bash", ["-n", toBashPath(path.join(handoffDir, "capture-production-postgres-backup.sh"))], { shell: false }).status, 0);
  const verify = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff:verify", "--bundle", handoffDir]);
  assert.equal(verify.status, 0, verify.stderr);
  const freeze = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff:freeze", "--bundle", handoffDir, "--output", freezeFile]);
  assert.equal(freeze.status, 0, freeze.stderr);
  assert.equal(JSON.parse(readFileSync(freezeFile, "utf8")).backup_performed, false);
}

function assertCapturePasses(env) {
  const result = runNode([
    "scripts/production-backup.mjs",
    "--compose-file",
    env.composeFile,
    "--shared-env",
    env.sharedEnv,
    "--runtime-image-env",
    env.runtimeImageEnv,
    "--output-dir",
    captureDir,
    "--handoff-source-commit",
    "a".repeat(40),
    "--handoff-capture-script-sha256",
    "b".repeat(64)
  ], { fakeDocker: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(captureDir).sort(), [
    "backup-capture-metadata.json",
    "backup-capture-receipt.json",
    "checksums.sha256",
    "main-service-production.dump"
  ].sort());
  assert.equal(readFileSync(path.join(captureDir, "main-service-production.dump")).subarray(0, 5).toString("ascii"), "PGDMP");
  const receipt = readJson(path.join(captureDir, "backup-capture-receipt.json"));
  assert.equal(receipt.backup.format, "POSTGRESQL_CUSTOM");
  assert.equal(receipt.production_mutation_performed, false);
  assert.equal(receipt.secrets_included, false);
  assertNoSensitiveText(JSON.stringify(receipt));
}

function assertRestorePasses() {
  const result = runNode([
    "scripts/production-restore-verify.mjs",
    "--input-dir",
    captureDir,
    "--receipt",
    restoreReceipt
  ], { fakeDocker: true });
  assert.equal(result.status, 0, result.stderr);
  const receipt = readJson(restoreReceipt);
  assert.equal(receipt.restore_command_result, "PASSED");
  assert.equal(receipt.migration_verification, "PASSED");
  assert.equal(receipt.teardown.result, "PASSED");
  assert.equal(receipt.production_restore_performed, false);
  assertNoSensitiveText(JSON.stringify(receipt));
}

function assertCombinedReceiptPasses() {
  const create = runNode([
    "scripts/production-backup-restore-evidence.mjs",
    "receipt:create",
    "--capture-dir",
    captureDir,
    "--restore-receipt",
    restoreReceipt,
    "--output",
    combinedReceipt
  ]);
  assert.equal(create.status, 0, create.stderr);
  const verify = runNode([
    "scripts/production-backup-restore-evidence.mjs",
    "receipt:verify",
    "--receipt",
    combinedReceipt,
    "--require-backup-restore-baseline"
  ]);
  assert.equal(verify.status, 0, verify.stderr);
}

function assertCaptureRejectsNonEmptyOutput(env) {
  const nonEmpty = path.join(temp, "non-empty-capture");
  mkdirSync(nonEmpty);
  writeFileSync(path.join(nonEmpty, "x"), "x");
  const result = runNode([
    "scripts/production-backup.mjs",
    "--compose-file",
    env.composeFile,
    "--shared-env",
    env.sharedEnv,
    "--runtime-image-env",
    env.runtimeImageEnv,
    "--output-dir",
    nonEmpty
  ], { fakeDocker: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty/u);
}

function assertRestoreRejectsPlainSql() {
  const dir = cloneCapture("plain-sql");
  writeFileSync(path.join(dir, "main-service-production.dump"), "select 1;\n");
  rewriteCaptureChecksums(dir);
  const result = restoreFixture(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /custom-format/u);
}

function assertRestoreRejectsChecksumMismatch() {
  const dir = cloneCapture("checksum-mismatch");
  writeFileSync(path.join(dir, "main-service-production.dump"), "PGDMPchanged\n");
  const result = restoreFixture(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum/u);
}

function assertRestoreRejectsSecretMetadata() {
  const dir = cloneCapture("secret-metadata");
  const metadataFile = path.join(dir, "backup-capture-metadata.json");
  const metadata = readJson(metadataFile);
  metadata.DATABASE_URL = "postgresql://example.invalid/secret";
  writeJson(metadataFile, metadata);
  rewriteCaptureChecksums(dir);
  const result = restoreFixture(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sensitive/u);
}

function assertRestoreRejectsRemoteDockerContext() {
  const result = restoreFixture(captureDir, { FAKE_DOCKER_CONTEXT_HOST: "ssh://production.example.invalid" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /remote Docker context rejected/u);
}

function assertRestoreRejectsTeardownLeak() {
  const result = restoreFixture(captureDir, { FAKE_TEARDOWN_LEFT: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /teardown|failed/u);
}

function assertCombinedReceiptRejectsStagingBackupSha() {
  const receipt = readJson(combinedReceipt);
  receipt.backup_sha256 = stagingBackupSha;
  const file = path.join(temp, "staging-substitution-receipt.json");
  writeJson(file, receipt);
  const result = runNode(["scripts/production-backup-restore-evidence.mjs", "receipt:verify", "--receipt", file]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /staging backup SHA/u);
}

function assertCombinedReceiptStrictRejectsFailedBaseline() {
  const receipt = readJson(combinedReceipt);
  receipt.migration_verification = "FAILED";
  receipt.backup_restore_baseline = "FAILED";
  const file = path.join(temp, "failed-baseline-receipt.json");
  writeJson(file, receipt);
  const structural = runNode(["scripts/production-backup-restore-evidence.mjs", "receipt:verify", "--receipt", file]);
  assert.equal(structural.status, 0, structural.stderr);
  const strict = runNode(["scripts/production-backup-restore-evidence.mjs", "receipt:verify", "--receipt", file, "--require-backup-restore-baseline"]);
  assert.notEqual(strict.status, 0);
  assert.match(strict.stderr, /baseline/u);
}

function assertHandoffRejectsChecksumMismatch() {
  const dir = cloneDirectory(handoffDir, "handoff-checksum-mismatch");
  writeFileSync(path.join(dir, "README.md"), `${readFileSync(path.join(dir, "README.md"), "utf8")}tamper\n`);
  const result = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff:verify", "--bundle", dir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum/u);
}

function assertHandoffRejectsCrlfShell() {
  const dir = cloneDirectory(handoffDir, "handoff-crlf");
  const shell = path.join(dir, "capture-production-postgres-backup.sh");
  writeFileSync(shell, readFileSync(shell, "utf8").replace(/\n/gu, "\r\n"));
  rewriteHandoffChecksums(dir);
  const result = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff:verify", "--bundle", dir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LF/u);
}

function assertHandoffRejectsForbiddenShellCommand() {
  const dir = cloneDirectory(handoffDir, "handoff-forbidden-shell");
  const shell = path.join(dir, "capture-production-postgres-backup.sh");
  writeFileSync(shell, `${readFileSync(shell, "utf8")}\nenv | grep DATABASE_URL\n`);
  rewriteHandoffChecksums(dir);
  const result = runNode(["scripts/production-backup-restore-evidence.mjs", "handoff:verify", "--bundle", dir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden shell/u);
}

function restoreFixture(dir, extraEnv = {}) {
  const receipt = path.join(temp, `restore-${path.basename(dir)}.json`);
  return runNode([
    "scripts/production-restore-verify.mjs",
    "--input-dir",
    dir,
    "--receipt",
    receipt
  ], { fakeDocker: true, env: extraEnv });
}

function writeCaptureFixture() {
  const fixtureRoot = path.join(temp, "capture-fixture");
  mkdirSync(fixtureRoot);
  const composeFile = path.join(fixtureRoot, "compose.yaml");
  const sharedEnv = path.join(fixtureRoot, ".env.production");
  const runtimeImageEnv = path.join(fixtureRoot, "runtime-image.env");
  writeFileSync(composeFile, "services:\n  postgres: {}\n");
  writeFileSync(sharedEnv, "POSTGRES_USER=main_service\nPOSTGRES_DB=main_service\nPOSTGRES_PASSWORD=not_printed_value\n");
  writeFileSync(runtimeImageEnv, `MAIN_SERVICE_IMAGE=sha256:${"a".repeat(64)}\n`);
  return { composeFile, sharedEnv, runtimeImageEnv };
}

function writeFakeDocker(directory) {
  const nodeFile = path.join(directory, "docker-fake.cjs");
  writeFileSync(nodeFile, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const joined = args.join(" ");
fs.appendFileSync(${JSON.stringify(path.join(temp, "docker-trace.txt"))}, joined + "\\n");
function out(text) { process.stdout.write(text); process.exit(0); }
function ok() { process.exit(0); }
function fail(message) { if (message) process.stderr.write(message + "\\n"); process.exit(1); }
if (joined.includes("context inspect")) {
  const host = process.env.FAKE_DOCKER_CONTEXT_HOST || "npipe:////./pipe/docker_engine";
  out(JSON.stringify([{ Name: "default", Endpoints: { docker: { Host: host } } }]) + "\\n");
}
if (joined.includes("image inspect postgres:17.9-bookworm")) out("sha256:${"c".repeat(64)}\\n");
if (joined.includes("compose") && joined.includes("exec -T postgres pg_dump")) out("PGDMPsynthetic-custom-dump\\n");
if (joined.includes("network create") || joined.includes("volume create")) out("created\\n");
if (joined.includes("run") && joined.includes("postgres:17.9-bookworm")) out("cid-restore\\n");
if (joined.includes("cp") && joined.includes("backup.dump")) ok();
if (joined.includes("exec") && joined.includes("pg_restore")) {
  if (process.env.FAKE_RESTORE_FAIL === "1") fail("restore failed");
  ok();
}
if (joined.includes("exec") && joined.includes("psql") && joined.includes("select 1")) out("1\\n");
if (joined.includes("exec") && joined.includes("psql") && joined.includes("information_schema.tables")) out((process.env.FAKE_TABLE_COUNT || "6") + "\\n");
if (joined.includes("exec") && joined.includes("psql") && joined.includes("_prisma_migrations") && joined.includes("finished_at")) out((process.env.FAKE_MIGRATION_COUNT || "2") + "\\n");
if (joined.includes("exec") && joined.includes("psql") && joined.includes("_prisma_migrations") && joined.includes("rolled_back_at")) out((process.env.FAKE_FAILED_MIGRATIONS || "0") + "\\n");
if (joined.startsWith("rm ") || joined.includes("volume rm") || joined.includes("network rm")) ok();
if (joined.includes("container inspect") || joined.includes("volume inspect") || joined.includes("network inspect")) {
  if (process.env.FAKE_TEARDOWN_LEFT === "1") ok();
  fail();
}
fail("unsupported fake docker command: " + joined);
`);
  writeFileSync(path.join(directory, "docker.cmd"), `@echo off\r\nnode "%~dp0docker-fake.cjs" %*\r\n`);
  writeFileSync(path.join(directory, "docker"), `#!/usr/bin/env bash\nexec node "${toBashPath(nodeFile)}" "$@"\n`);
  spawnSync("chmod", ["755", path.join(directory, "docker")], { shell: false });
}

function cloneCapture(name) {
  return cloneDirectory(captureDir, name);
}

function cloneDirectory(source, name) {
  const destination = path.join(temp, name);
  cpSync(source, destination, { recursive: true });
  return destination;
}

function rewriteCaptureChecksums(dir) {
  const files = ["main-service-production.dump", "backup-capture-metadata.json", "backup-capture-receipt.json"];
  writeFileSync(path.join(dir, "checksums.sha256"), `${files.map((file) => `${sha256(readFileSync(path.join(dir, file)))}  ${file}`).join("\n")}\n`);
}

function rewriteHandoffChecksums(dir) {
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = readJson(manifestFile);
  manifest.capture_script.sha256 = sha256(readFileSync(path.join(dir, "capture-production-postgres-backup.sh")));
  manifest.restore_wrapper.sha256 = sha256(readFileSync(path.join(dir, "verify-off-host-postgres-restore.sh")));
  manifest.payload_files = ["README.md", "capture-production-postgres-backup.sh", "verify-off-host-postgres-restore.sh", "backup-restore-contract.json"].map((file) => ({
    path: file,
    bytes: statSync(path.join(dir, file)).size,
    sha256: sha256(readFileSync(path.join(dir, file)))
  }));
  writeJson(manifestFile, manifest);
  const files = [
    "README.md",
    "backup-restore-contract.json",
    "capture-production-postgres-backup.sh",
    "manifest.json",
    "verify-off-host-postgres-restore.sh"
  ];
  writeFileSync(path.join(dir, "checksums.sha256"), `${files.map((file) => `${sha256(readFileSync(path.join(dir, file)))}  ${file}`).join("\n")}\n`);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      ...(options.fakeDocker ? { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } : {}),
      ...(options.env ?? {})
    }
  });
}

function assertNoSensitiveText(text) {
  assert.equal(/DATABASE_URL|POSTGRES_PASSWORD|AGENT_KEY|TENANT_RATE_LIMIT_KEY_SECRET|PGPASSWORD/iu.test(text), false);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toBashPath(file) {
  const resolved = path.resolve(file);
  const driveMatch = /^([A-Za-z]):\\(.*)$/u.exec(resolved);
  if (driveMatch !== null) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replaceAll("\\", "/")}`;
  }
  return resolved.replaceAll(path.sep, "/");
}
