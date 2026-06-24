import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATIONS, RELEASE_IDENTITY } from "./release-identity.mjs";

const CONTRACT_VERSION = "production-backup-restore-evidence-v1";
const MILESTONE = "MS-019C";
const CANONICAL_REMOTE = "https://github.com/hktnv/habersoft-rss";
const PARENT_OPERATIONAL_RECEIPT_SHA256 = "3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620";
const STAGING_BACKUP_SHA256 = "595ee0617d86f5886aca25ae99486f064ce06e081d16fec19fec74cdd8db9bfc";
const POSTGRES_IMAGE = "postgres:17.9-bookworm";
const DEPENDENCY_MODE = "LANDED_MAIN_PINNED_TOOLING";
const DUMP_FILENAME = "main-service-production.dump";
const METADATA_FILENAME = "backup-capture-metadata.json";
const CAPTURE_RECEIPT_FILENAME = "backup-capture-receipt.json";
const CHECKSUMS_FILENAME = "checksums.sha256";
const CAPTURE_SOURCE = "scripts/production-backup-restore-capture.sh";
const RESTORE_SOURCE = "scripts/production-backup-restore-off-host-verify.sh";
const CAPTURE_BUNDLE = "capture-production-postgres-backup.sh";
const RESTORE_BUNDLE = "verify-off-host-postgres-restore.sh";
const TOOLING_LOCK = "repository-tooling-lock.json";
const CAPTURE_BUNDLE_FILES = Object.freeze([DUMP_FILENAME, METADATA_FILENAME, CAPTURE_RECEIPT_FILENAME, CHECKSUMS_FILENAME]);
const CAPTURE_CHECKSUM_FILES = Object.freeze([DUMP_FILENAME, METADATA_FILENAME, CAPTURE_RECEIPT_FILENAME]);
const REQUIRED_TOOL_FILES = Object.freeze([
  "package.json",
  "scripts/release-identity.mjs",
  "scripts/production-backup.mjs",
  "scripts/production-restore-verify.mjs",
  "scripts/production-backup-restore-evidence.mjs",
  CAPTURE_SOURCE,
  RESTORE_SOURCE
]);
const HANDOFF_FILES = Object.freeze([
  "README.md",
  CAPTURE_BUNDLE,
  RESTORE_BUNDLE,
  "backup-restore-contract.json",
  TOOLING_LOCK,
  "manifest.json",
  "checksums.sha256"
]);
const CHECKSUM_FILES = HANDOFF_FILES.filter((file) => file !== "checksums.sha256");
const CANONICAL_TABLES = Object.freeze([
  "feeds",
  "entries",
  "entry_details",
  "site_feeds",
  "agent_feed_check_events",
  "agent_runtime_status"
]);

const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

try {
  switch (command) {
    case "handoff":
    case "handoff:generate":
      generateHandoff(args);
      break;
    case "handoff:verify":
      verifyHandoffCommand(args);
      break;
    case "handoff:freeze":
      freezeHandoffCommand(args);
      break;
    case "authority:create":
      createReturnedBackupAuthorityCommand(args);
      break;
    case "authority:verify":
      verifyReturnedBackupAuthorityCommand(args);
      break;
    case "receipt:create":
      createCombinedReceiptCommand(args);
      break;
    case "receipt:verify":
      verifyCombinedReceiptCommand(args);
      break;
    default:
      fail("usage: production-backup-restore-evidence <handoff|handoff:verify|handoff:freeze|authority:create|authority:verify|receipt:create|receipt:verify>");
  }
} catch (error) {
  fail(error.message);
}

function generateHandoff(options) {
  const outputDir = externalPath(options.output ?? options["output-dir"], "output");
  prepareEmptyOutputDir(outputDir);
  const generatedAt = new Date().toISOString();
  const sourceCommit = gitOutput(["rev-parse", "HEAD"]);
  const toolingLock = createToolingLock(sourceCommit);
  const captureText = renderWrapper(readText(CAPTURE_SOURCE), toolingLock);
  const restoreText = renderWrapper(readText(RESTORE_SOURCE), toolingLock);
  writeText(path.join(outputDir, CAPTURE_BUNDLE), captureText, 0o755);
  writeText(path.join(outputDir, RESTORE_BUNDLE), restoreText, 0o755);
  writeText(path.join(outputDir, "README.md"), renderReadme(generatedAt), 0o644);
  writeJson(path.join(outputDir, "backup-restore-contract.json"), createContract(), 0o644);
  writeJson(path.join(outputDir, TOOLING_LOCK), toolingLock, 0o644);
  const manifest = createManifest(outputDir, generatedAt, sourceCommit, toolingLock);
  writeJson(path.join(outputDir, "manifest.json"), manifest, 0o644);
  writeChecksums(outputDir, CHECKSUM_FILES);
  const verified = verifyHandoff(outputDir);
  console.log(JSON.stringify({
    status: "production-backup-restore-handoff-generated",
    bundle: outputDir,
    verified: verified.ok,
    manifest_sha256: sha256(readFileSync(path.join(outputDir, "manifest.json"))),
    capture_script_sha256: sha256(readFileSync(path.join(outputDir, CAPTURE_BUNDLE))),
    restore_wrapper_sha256: sha256(readFileSync(path.join(outputDir, RESTORE_BUNDLE))),
    production_contact_performed: false,
    backup_performed: false,
    restore_performed: false
  }, null, 2));
}

function verifyHandoffCommand(options) {
  const bundle = externalPath(options.bundle ?? options.input, "bundle");
  const result = verifyHandoff(bundle);
  console.log(JSON.stringify({
    status: "production-backup-restore-handoff-verified",
    bundle,
    files: result.files,
    manifest_sha256: sha256(readFileSync(path.join(bundle, "manifest.json"))),
    capture_script_sha256: result.manifest.capture_script.sha256,
    restore_wrapper_sha256: result.manifest.restore_wrapper.sha256,
    tooling_lock_sha256: result.manifest.repository_tooling_lock.sha256,
    production_contact_performed: false,
    backup_performed: false,
    restore_performed: false
  }, null, 2));
}

function freezeHandoffCommand(options) {
  const bundle = externalPath(options.bundle, "bundle");
  const output = externalPath(options.output, "output");
  assert(!existsSync(output), "freeze output must not already exist");
  const result = verifyHandoff(bundle);
  const freeze = {
    schema_version: 1,
    freeze_type: "production-backup-restore-handoff-freeze",
    milestone: MILESTONE,
    contract_version: CONTRACT_VERSION,
    source_commit: result.manifest.generation_source_commit,
    bundle_files: result.files,
    manifest_sha256: sha256(readFileSync(path.join(bundle, "manifest.json"))),
    capture_script_sha256: result.manifest.capture_script.sha256,
    restore_wrapper_sha256: result.manifest.restore_wrapper.sha256,
    tooling_lock_sha256: result.manifest.repository_tooling_lock.sha256,
    dependency_mode: result.manifest.dependency_mode,
    core_cli_contract_version: result.manifest.core_cli_contract_version,
    lf_bash_syntax_result: "PASSED",
    end_to_end_synthetic_smoke_result: options["synthetic-smoke-result"] ?? "NOT_RUN",
    generated_at_utc: new Date().toISOString(),
    production_contact_performed: false,
    production_mutation_performed: false,
    backup_performed: false,
    restore_performed: false
  };
  writeJson(output, freeze, 0o600);
  console.log(JSON.stringify({
    status: "production-backup-restore-handoff-freeze-created",
    freeze: output,
    freeze_sha256: sha256(readFileSync(output)),
    manifest_sha256: freeze.manifest_sha256,
    capture_script_sha256: freeze.capture_script_sha256,
    restore_wrapper_sha256: freeze.restore_wrapper_sha256,
    tooling_lock_sha256: freeze.tooling_lock_sha256
  }, null, 2));
}

function createCombinedReceiptCommand(options) {
  const captureDir = externalPath(options["capture-dir"], "capture-dir");
  const restoreReceiptFile = externalPath(options["restore-receipt"], "restore-receipt");
  const authorityFile = externalPath(options.authority, "authority");
  const handoffDir = externalPath(options.handoff, "handoff");
  const output = externalPath(options.output, "output");
  assert(!existsSync(output), "combined receipt output must not already exist");
  const captureReceiptFile = path.join(captureDir, "backup-capture-receipt.json");
  const captureReceipt = readJson(captureReceiptFile);
  const restoreReceipt = readJson(restoreReceiptFile);
  const captureEvidence = readCaptureBundleEvidence(captureDir);
  const authority = readJson(authorityFile);
  validateReturnedBackupAuthority(authority, { captureEvidence });
  const handoff = verifyHandoff(handoffDir);
  const receipt = createCombinedReceipt(captureReceipt, restoreReceipt, {
    captureReceiptSha256: sha256(readFileSync(captureReceiptFile)),
    captureMetadataSha256: captureEvidence.metadataSha256,
    restoreReceiptSha256: sha256(readFileSync(restoreReceiptFile)),
    authorityRecordSha256: sha256(readFileSync(authorityFile)),
    returnedBackupTreeDigestSha256: captureEvidence.treeDigestSha256,
    handoffManifestSha256: sha256(readFileSync(path.join(handoffDir, "manifest.json"))),
    toolingLockSha256: sha256(readFileSync(path.join(handoffDir, TOOLING_LOCK))),
    handoffGenerationSourceCommit: handoff.manifest.generation_source_commit,
    handoffCaptureScriptSha256: handoff.manifest.capture_script.sha256,
    handoffRestoreWrapperSha256: handoff.manifest.restore_wrapper.sha256,
    localVerifierSourceCommit: gitOutput(["rev-parse", "HEAD"])
  });
  validateCombinedReceipt(receipt, { requireBaseline: false });
  writeJson(output, receipt, 0o600);
  console.log(JSON.stringify({
    status: "production-backup-restore-receipt-created",
    receipt: output,
    sha256: sha256(readFileSync(output)),
    backup_restore_baseline: receipt.backup_restore_baseline
  }, null, 2));
}

function createReturnedBackupAuthorityCommand(options) {
  const captureDir = externalPath(options["capture-dir"] ?? options["input-dir"], "capture-dir");
  const output = externalPath(options.output, "output");
  const captureEvidence = readCaptureBundleEvidence(captureDir);
  if (existsSync(output)) {
    const existing = readJson(output);
    validateReturnedBackupAuthority(existing, { captureEvidence });
    console.log(JSON.stringify({
      status: "production-backup-returned-authority-verified",
      authority: output,
      sha256: sha256(readFileSync(output)),
      returned_backup_tree_digest_sha256: existing.returned_backup_tree_digest_sha256,
      backup_sha256: existing.backup_sha256
    }, null, 2));
    return;
  }
  const authority = createReturnedBackupAuthority(captureEvidence);
  validateReturnedBackupAuthority(authority, { captureEvidence });
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeJsonNew(output, authority, 0o600);
  console.log(JSON.stringify({
    status: "production-backup-returned-authority-created",
    authority: output,
    sha256: sha256(readFileSync(output)),
    returned_backup_tree_digest_sha256: authority.returned_backup_tree_digest_sha256,
    backup_sha256: authority.backup_sha256
  }, null, 2));
}

function verifyReturnedBackupAuthorityCommand(options) {
  const authorityFile = externalPath(options.authority ?? options.input, "authority");
  const captureEvidence = options["capture-dir"] === undefined
    ? undefined
    : readCaptureBundleEvidence(externalPath(options["capture-dir"], "capture-dir"));
  const authority = readJson(authorityFile);
  validateReturnedBackupAuthority(authority, { captureEvidence });
  console.log(JSON.stringify({
    status: "production-backup-returned-authority-verified",
    authority: authorityFile,
    sha256: sha256(readFileSync(authorityFile)),
    returned_backup_tree_digest_sha256: authority.returned_backup_tree_digest_sha256,
    backup_sha256: authority.backup_sha256,
    secrets_included: false
  }, null, 2));
}

function verifyCombinedReceiptCommand(options) {
  const receiptFile = externalPath(options.receipt ?? options.input, "receipt");
  const receipt = readJson(receiptFile);
  validateCombinedReceipt(receipt, { requireBaseline: options["require-backup-restore-baseline"] === "true" });
  console.log(JSON.stringify({
    status: "production-backup-restore-receipt-verified",
    receipt: receiptFile,
    sha256: sha256(readFileSync(receiptFile)),
    backup_restore_baseline: receipt.backup_restore_baseline,
    production_mutation_performed: false
  }, null, 2));
}

function verifyHandoff(bundle) {
  assert(existsSync(bundle) && statSync(bundle).isDirectory(), "bundle must be an existing directory");
  assertExactFiles(bundle, HANDOFF_FILES);
  const checksumMap = verifyChecksums(bundle, CHECKSUM_FILES);
  const manifest = readJson(path.join(bundle, "manifest.json"));
  const contract = readJson(path.join(bundle, "backup-restore-contract.json"));
  const toolingLock = readJson(path.join(bundle, TOOLING_LOCK));
  const capture = readText(path.join(bundle, CAPTURE_BUNDLE));
  const restore = readText(path.join(bundle, RESTORE_BUNDLE));
  validateManifest(manifest, checksumMap);
  validateContract(contract);
  validateToolingLock(toolingLock);
  assert(manifest.repository_tooling_lock?.sha256 === checksumMap.get(TOOLING_LOCK), "manifest tooling lock checksum mismatch");
  assert(toolingLock.required_landed_commit === manifest.generation_source_commit, "tooling lock commit mismatch");
  for (const file of ["README.md", "backup-restore-contract.json", TOOLING_LOCK, "manifest.json", CAPTURE_BUNDLE, RESTORE_BUNDLE]) {
    scanTextForSecrets(readText(path.join(bundle, file)), file);
  }
  assert(!capture.includes("\r"), "capture shell must use LF");
  assert(!restore.includes("\r"), "restore wrapper must use LF");
  assertBashSyntax(path.join(bundle, CAPTURE_BUNDLE), CAPTURE_BUNDLE);
  assertBashSyntax(path.join(bundle, RESTORE_BUNDLE), RESTORE_BUNDLE);
  scanShellForForbiddenCommands(capture, CAPTURE_BUNDLE);
  scanShellForForbiddenCommands(restore, RESTORE_BUNDLE);
  return { ok: true, files: HANDOFF_FILES, manifest };
}

function createCombinedReceipt(captureReceipt, restoreReceipt, hashes) {
  const baseline =
    captureReceipt.receipt_type === "production-backup-capture" &&
    restoreReceipt.receipt_type === "off-host-disposable-restore" &&
    restoreReceipt.returned_backup_authority_sha256 === hashes.authorityRecordSha256 &&
    restoreReceipt.backup_sha256 === captureReceipt.backup?.sha256 &&
    restoreReceipt.backup_bytes === captureReceipt.backup?.bytes &&
    restoreReceipt.capture_receipt_sha256 === hashes.captureReceiptSha256 &&
    restoreReceipt.restore_command_result === "PASSED" &&
    restoreReceipt.table_verification === "PASSED" &&
    restoreReceipt.migration_verification === "PASSED" &&
    restoreReceipt.teardown?.result === "PASSED" &&
    restoreReceipt.docker_context?.local_engine === true &&
    restoreReceipt.production_mutation_performed === false &&
    restoreReceipt.production_restore_performed === false
      ? "PASSED"
      : "FAILED";
  return {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    receipt_type: "production-backup-restore-acceptance",
    milestone: MILESTONE,
    service: RELEASE_IDENTITY.application,
    environment: "production",
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    handoff_manifest_sha256: hashes.handoffManifestSha256,
    handoff_generation_source_commit: hashes.handoffGenerationSourceCommit,
    handoff_capture_script_sha256: hashes.handoffCaptureScriptSha256,
    handoff_restore_wrapper_sha256: hashes.handoffRestoreWrapperSha256,
    repository_tooling_lock_sha256: hashes.toolingLockSha256,
    local_verifier_source_commit: hashes.localVerifierSourceCommit,
    returned_backup_authority_sha256: hashes.authorityRecordSha256,
    returned_backup_tree_digest_sha256: hashes.returnedBackupTreeDigestSha256,
    backup_capture_receipt_sha256: hashes.captureReceiptSha256,
    backup_capture_metadata_sha256: hashes.captureMetadataSha256,
    backup_sha256: captureReceipt.backup?.sha256,
    backup_bytes: captureReceipt.backup?.bytes,
    captured_at_utc: captureReceipt.captured_at_utc,
    off_host_restore_receipt_sha256: hashes.restoreReceiptSha256,
    restored_at_utc: restoreReceipt.restored_at_utc,
    docker_context_class: restoreReceipt.docker_context?.class,
    postgres_image: restoreReceipt.postgres?.image,
    postgres_image_id: restoreReceipt.postgres?.image_id,
    restore_command_result: restoreReceipt.restore_command_result,
    structural_verification: "PASSED",
    table_verification: restoreReceipt.table_verification,
    canonical_tables: restoreReceipt.canonical_tables,
    expected_migrations: restoreReceipt.expected_migrations,
    migration_verification: restoreReceipt.migration_verification,
    teardown_result: restoreReceipt.teardown?.result,
    canonical_repository: CANONICAL_REMOTE,
    backup_restore_baseline: baseline,
    production_mutation_performed: false,
    deployment_performed: false,
    migration_performed_by_codex: false,
    production_restore_performed: false,
    secrets_included: false
  };
}

function validateCombinedReceipt(receipt, options) {
  scanTextForSecrets(JSON.stringify(receipt), "combined receipt");
  assert(receipt.schema_version === 1, "receipt schema mismatch");
  assert(receipt.contract_version === CONTRACT_VERSION, "receipt contract mismatch");
  assert(receipt.receipt_type === "production-backup-restore-acceptance", "receipt type mismatch");
  assert(receipt.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "parent MS-019B receipt mismatch");
  assertOptionalSha(receipt.handoff_manifest_sha256, "handoff manifest SHA malformed");
  assertOptionalGitSha(receipt.handoff_generation_source_commit, "handoff source commit malformed");
  assertOptionalSha(receipt.handoff_capture_script_sha256, "handoff capture SHA malformed");
  assertOptionalSha(receipt.handoff_restore_wrapper_sha256, "handoff restore SHA malformed");
  assertOptionalSha(receipt.repository_tooling_lock_sha256, "tooling lock SHA malformed");
  assertOptionalGitSha(receipt.local_verifier_source_commit, "local verifier commit malformed");
  assertOptionalSha(receipt.returned_backup_authority_sha256, "authority record SHA malformed");
  assertOptionalSha(receipt.returned_backup_tree_digest_sha256, "authority tree digest malformed");
  assert(isSha256(receipt.backup_capture_receipt_sha256), "capture receipt SHA malformed");
  assertOptionalSha(receipt.backup_capture_metadata_sha256, "capture metadata SHA malformed");
  assert(isSha256(receipt.backup_sha256), "backup SHA malformed");
  assert(receipt.backup_sha256 !== STAGING_BACKUP_SHA256, "staging backup SHA cannot substitute production backup SHA");
  assert(Number.isInteger(receipt.backup_bytes) && receipt.backup_bytes > 0, "backup size invalid");
  assert(isSha256(receipt.off_host_restore_receipt_sha256), "restore receipt SHA malformed");
  assert(receipt.docker_context_class === undefined || ["LOCAL_UNIX_SOCKET", "LOCAL_WINDOWS_NPIPE"].includes(receipt.docker_context_class), "Docker context class invalid");
  assert(receipt.postgres_image === undefined || receipt.postgres_image === POSTGRES_IMAGE, "PostgreSQL image mismatch");
  assert(receipt.postgres_image_id === undefined || /^sha256:[a-f0-9]{64}$/u.test(receipt.postgres_image_id), "PostgreSQL image id malformed");
  assert(receipt.restore_command_result === undefined || ["PASSED", "FAILED"].includes(receipt.restore_command_result), "restore command status invalid");
  assert(receipt.structural_verification === "PASSED", "structural verification must pass");
  assert(receipt.table_verification === undefined || ["PASSED", "FAILED"].includes(receipt.table_verification), "table verification status invalid");
  assert(["PASSED", "FAILED"].includes(receipt.migration_verification), "migration verification status invalid");
  assert(["PASSED", "FAILED"].includes(receipt.teardown_result), "teardown status invalid");
  assert(receipt.production_mutation_performed === false, "production mutation flag must be false");
  assert(receipt.production_restore_performed === false, "production restore flag must be false");
  assert(receipt.secrets_included === false, "secrets flag must be false");
  const expectedBaseline =
    (receipt.restore_command_result === undefined || receipt.restore_command_result === "PASSED") &&
    (receipt.table_verification === undefined || receipt.table_verification === "PASSED") &&
    receipt.migration_verification === "PASSED" &&
    receipt.teardown_result === "PASSED"
      ? "PASSED"
      : "FAILED";
  assert(receipt.backup_restore_baseline === expectedBaseline, `backup_restore_baseline must be ${expectedBaseline}`);
  if (options.requireBaseline === true) {
    assert(receipt.backup_restore_baseline === "PASSED", "backup restore baseline is not passed");
    assert(isSha256(receipt.handoff_manifest_sha256), "handoff manifest SHA required for strict baseline");
    assert(isGitSha(receipt.handoff_generation_source_commit), "handoff source commit required for strict baseline");
    assert(isSha256(receipt.repository_tooling_lock_sha256), "tooling lock SHA required for strict baseline");
    assert(isSha256(receipt.returned_backup_authority_sha256), "authority record SHA required for strict baseline");
    assert(isSha256(receipt.returned_backup_tree_digest_sha256), "authority tree digest required for strict baseline");
    assert(isSha256(receipt.backup_capture_metadata_sha256), "capture metadata SHA required for strict baseline");
    assert(isGitSha(receipt.local_verifier_source_commit), "local verifier commit required for strict baseline");
    assert(receipt.docker_context_class === "LOCAL_UNIX_SOCKET" || receipt.docker_context_class === "LOCAL_WINDOWS_NPIPE", "local Docker context required for strict baseline");
    assert(receipt.postgres_image === POSTGRES_IMAGE, "PostgreSQL image required for strict baseline");
    assert(/^sha256:[a-f0-9]{64}$/u.test(receipt.postgres_image_id), "PostgreSQL image id required for strict baseline");
    assert(receipt.restore_command_result === "PASSED", "restore command must pass for strict baseline");
    assert(receipt.table_verification === "PASSED", "table verification must pass for strict baseline");
  }
}

function createReturnedBackupAuthority(captureEvidence) {
  return {
    schema_version: 1,
    authority_type: "production-backup-returned-v2-authority",
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: RELEASE_IDENTITY.application,
    environment: "production",
    created_at_utc: new Date().toISOString(),
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    expected_inventory: [...CAPTURE_BUNDLE_FILES],
    actual_inventory: captureEvidence.fileInventory,
    checksums_sha256: captureEvidence.checksumsSha256,
    returned_backup_tree_digest_sha256: captureEvidence.treeDigestSha256,
    backup_sha256: captureEvidence.backupSha256,
    backup_bytes: captureEvidence.backupBytes,
    backup_format: "POSTGRESQL_CUSTOM",
    capture_metadata_sha256: captureEvidence.metadataSha256,
    capture_receipt_sha256: captureEvidence.captureReceiptSha256,
    captured_at_utc: captureEvidence.captureReceipt.captured_at_utc,
    capture_receipt_type: captureEvidence.captureReceipt.receipt_type,
    production_contact_performed_by_codex: false,
    production_mutation_performed: false,
    production_restore_performed: false,
    raw_dump_content_included: false,
    row_data_included: false,
    raw_sql_included: false,
    secrets_included: false
  };
}

function validateReturnedBackupAuthority(authority, { captureEvidence } = {}) {
  scanTextForSecrets(JSON.stringify(authority), "returned backup authority");
  assertNoPrivateLocatorText(JSON.stringify(authority), "returned backup authority");
  assert(authority.schema_version === 1, "authority schema mismatch");
  assert(authority.authority_type === "production-backup-returned-v2-authority", "authority type mismatch");
  assert(authority.contract_version === CONTRACT_VERSION, "authority contract mismatch");
  assert(authority.milestone === MILESTONE, "authority milestone mismatch");
  assert(authority.service === RELEASE_IDENTITY.application, "authority service mismatch");
  assert(authority.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "authority parent receipt mismatch");
  assertSameArray(authority.expected_inventory, [...CAPTURE_BUNDLE_FILES], "authority expected inventory mismatch");
  assert(Array.isArray(authority.actual_inventory), "authority actual inventory invalid");
  assertSameArray(authority.actual_inventory.map((file) => file.path), [...CAPTURE_BUNDLE_FILES], "authority actual inventory mismatch");
  for (const file of authority.actual_inventory) {
    assert(CAPTURE_BUNDLE_FILES.includes(file.path), "authority unexpected file");
    assert(Number.isInteger(file.bytes) && file.bytes > 0, `authority file size invalid for ${file.path}`);
    assert(isSha256(file.sha256), `authority file SHA malformed for ${file.path}`);
  }
  assert(isSha256(authority.checksums_sha256), "authority checksums SHA malformed");
  assert(isSha256(authority.returned_backup_tree_digest_sha256), "authority tree digest malformed");
  assert(isSha256(authority.backup_sha256), "authority backup SHA malformed");
  assert(authority.backup_sha256 !== STAGING_BACKUP_SHA256, "staging backup SHA cannot substitute production backup SHA");
  assert(Number.isInteger(authority.backup_bytes) && authority.backup_bytes > 0, "authority backup size invalid");
  assert(authority.backup_format === "POSTGRESQL_CUSTOM", "authority backup format mismatch");
  assert(isSha256(authority.capture_metadata_sha256), "authority metadata SHA malformed");
  assert(isSha256(authority.capture_receipt_sha256), "authority capture receipt SHA malformed");
  assert(authority.capture_receipt_type === "production-backup-capture", "authority capture receipt type mismatch");
  for (const key of [
    "production_contact_performed_by_codex",
    "production_mutation_performed",
    "production_restore_performed",
    "raw_dump_content_included",
    "row_data_included",
    "raw_sql_included",
    "secrets_included"
  ]) {
    assert(authority[key] === false, `authority ${key} must be false`);
  }
  if (captureEvidence !== undefined) {
    assert(authority.checksums_sha256 === captureEvidence.checksumsSha256, "authority checksums SHA mismatch");
    assert(authority.returned_backup_tree_digest_sha256 === captureEvidence.treeDigestSha256, "authority tree digest mismatch");
    assert(authority.backup_sha256 === captureEvidence.backupSha256, "authority backup SHA mismatch");
    assert(authority.backup_bytes === captureEvidence.backupBytes, "authority backup size mismatch");
    assert(authority.capture_metadata_sha256 === captureEvidence.metadataSha256, "authority metadata SHA mismatch");
    assert(authority.capture_receipt_sha256 === captureEvidence.captureReceiptSha256, "authority capture receipt SHA mismatch");
    assert(authority.captured_at_utc === captureEvidence.captureReceipt.captured_at_utc, "authority captured timestamp mismatch");
    assert(JSON.stringify(authority.actual_inventory) === JSON.stringify(captureEvidence.fileInventory), "authority file inventory mismatch");
  }
}

function createManifest(outputDir, generatedAt, sourceCommit, toolingLock) {
  return {
    schema_version: 1,
    bundle_type: "production-backup-restore-handoff",
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: RELEASE_IDENTITY.application,
    source_environment: "production",
    restore_environment: "off-host-disposable",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    canonical_remote: CANONICAL_REMOTE,
    dependency_mode: DEPENDENCY_MODE,
    required_landed_commit: sourceCommit,
    core_cli_contract_version: CONTRACT_VERSION,
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    backup_format: "POSTGRESQL_CUSTOM",
    production_compose_context_mode: "EXPLICIT_PRODUCTION_COMPOSE_TWO_ENV_FILES",
    postgres_image: POSTGRES_IMAGE,
    expected_tables: [...CANONICAL_TABLES],
    expected_migrations: [...EXPECTED_MIGRATIONS],
    generated_by: "scripts/production-backup-restore-evidence.mjs",
    generated_at_utc: generatedAt,
    generation_source_commit: sourceCommit,
    capture_script: {
      filename: CAPTURE_BUNDLE,
      sha256: sha256(readFileSync(path.join(outputDir, CAPTURE_BUNDLE))),
      executable_intended: true,
      preflight_only_supported: true
    },
    restore_wrapper: {
      filename: RESTORE_BUNDLE,
      sha256: sha256(readFileSync(path.join(outputDir, RESTORE_BUNDLE))),
      executable_intended: true,
      preflight_only_supported: true
    },
    repository_tooling_lock: {
      filename: TOOLING_LOCK,
      sha256: sha256(readFileSync(path.join(outputDir, TOOLING_LOCK))),
      required_file_count: toolingLock.required_files.length
    },
    core_backup_script: toolingLock.required_files.find((file) => file.path === "scripts/production-backup.mjs"),
    restore_verifier_script: toolingLock.required_files.find((file) => file.path === "scripts/production-restore-verify.mjs"),
    payload_files: ["README.md", CAPTURE_BUNDLE, RESTORE_BUNDLE, "backup-restore-contract.json", TOOLING_LOCK].map((file) => fileMetadata(outputDir, file)),
    production_contact_performed: false,
    production_mutation_performed: false,
    deployment_performed: false,
    migration_performed: false,
    backup_performed: false,
    restore_performed: false,
    artifact_publication_performed: false,
    git_tag_created: false,
    github_release_created: false,
    secrets_included: false
  };
}

function createContract() {
  return {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: RELEASE_IDENTITY.application,
    dependency_mode: DEPENDENCY_MODE,
    core_cli_contract_version: CONTRACT_VERSION,
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    repository_tooling: {
      required_commit_source: "manifest.generation_source_commit",
      required_files_source: TOOLING_LOCK,
      global_worktree_clean_required: false,
      required_tool_files_must_match_sha256: true,
      required_tool_files_must_be_unmodified: true
    },
    wrapper_interfaces: {
      capture: {
        flags: ["--repository-dir", "--compose-file", "--shared-env", "--runtime-image-env", "--output-dir", "--preflight-only"],
        output_dir_maps_to_core_bundle_mode: true,
        unsupported_output_flag: "--output"
      },
      restore: {
        flags: ["--repository-dir", "--input-dir", "--receipt", "--preflight-only"],
        docker_resources_created_by_preflight: false
      }
    },
    backup_capture: {
      format: "POSTGRESQL_CUSTOM",
      output_files: [
        "main-service-production.dump",
        "backup-capture-metadata.json",
        "backup-capture-receipt.json",
        "checksums.sha256"
      ],
      compose_context_mode: "EXPLICIT_PRODUCTION_COMPOSE_TWO_ENV_FILES",
      production_read_only: true,
      preflight_only_supported: true,
      no_secret_output: true,
      no_overwrite: true
    },
    off_host_restore: {
      docker_context_allowed_classes: ["LOCAL_UNIX_SOCKET", "LOCAL_WINDOWS_NPIPE"],
      docker_context_rejected_classes: ["SSH", "REMOTE_TCP", "PRODUCTION_ALIAS", "UNKNOWN"],
      postgres_image: POSTGRES_IMAGE,
      disposable_resources_required: true,
      host_port_policy: "NO_HOST_PORT",
      expected_tables: [...CANONICAL_TABLES],
      expected_migrations: [...EXPECTED_MIGRATIONS],
      teardown_required: true
    },
    combined_receipt: {
      parent_ms019b_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
      strict_flag: "--require-backup-restore-baseline",
      staging_backup_sha_rejected: STAGING_BACKUP_SHA256
    },
    safety_flags: {
      production_contact_performed: false,
      production_mutation_performed: false,
      deployment_performed: false,
      migration_performed: false,
      backup_performed_by_handoff_generation: false,
      restore_performed_by_handoff_generation: false,
      artifact_publication_performed: false,
      git_tag_created: false,
      github_release_created: false,
      secrets_included: false
    }
  };
}

function createToolingLock(sourceCommit) {
  return {
    schema_version: 1,
    lock_type: "production-backup-restore-repository-tooling-lock",
    milestone: MILESTONE,
    dependency_mode: DEPENDENCY_MODE,
    canonical_remote: CANONICAL_REMOTE,
    required_landed_commit: sourceCommit,
    core_cli_contract_version: CONTRACT_VERSION,
    package_script_identities: {
      backup: "production:backup",
      restore_verify: "production:restore:verify",
      handoff: "production:backup-restore:handoff"
    },
    required_files: REQUIRED_TOOL_FILES.map((relativePath) => {
      assert(existsSync(relativePath), `required tool file missing: ${relativePath}`);
      return {
        path: relativePath,
        sha256: sha256(readFileSync(relativePath))
      };
    }),
    global_worktree_clean_required: false,
    required_tool_files_must_be_unmodified: true,
    production_contact_performed: false,
    production_mutation_performed: false,
    secrets_included: false
  };
}

function renderWrapper(source, toolingLock) {
  const requiredToolLines = toolingLock.required_files.map((file) => `${file.path} ${file.sha256}`).join("\n");
  return source
    .replaceAll("__MS019C_SOURCE_COMMIT__", toolingLock.required_landed_commit)
    .replaceAll("__MS019C_REQUIRED_TOOLING_COMMIT__", toolingLock.required_landed_commit)
    .replaceAll("__MS019C_CANONICAL_REMOTE__", CANONICAL_REMOTE)
    .replaceAll("__MS019C_CONTRACT_VERSION__", CONTRACT_VERSION)
    .replaceAll("__MS019C_REQUIRED_TOOL_LINES__", requiredToolLines);
}

function renderReadme(generatedAt) {
  return `# MS-019C Production Backup Restore Handoff

This bundle prepares a production PostgreSQL custom-format backup capture and later off-host disposable restore verification for main-service.

Generating or verifying this bundle does not contact production, take a backup, restore a database, mutate services, deploy, publish an artifact, create a Git tag or create a GitHub Release.

Handoff-v1 is historical and superseded. This handoff uses ${DEPENDENCY_MODE}: the production checkout must be on canonical main at the landed source commit or a descendant, and the wrapper verifies the required tool file hashes before any backup starts.

First pull landed tooling:

\`\`\`bash
cd /opt/habersoft-rss
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD
\`\`\`

Then verify this handoff bundle:

\`\`\`bash
cd <approved-ms-019c-handoff-v2-dir>
sha256sum -c checksums.sha256
bash -n capture-production-postgres-backup.sh
bash -n verify-off-host-postgres-restore.sh
\`\`\`

Safe preflight-only command shape:

\`\`\`bash
cd /opt/habersoft-rss
<approved-ms-019c-handoff-v2-dir>/capture-production-postgres-backup.sh \\
  --repository-dir /opt/habersoft-rss \\
  --compose-file deploy/production/compose.yaml \\
  --shared-env .env.production \\
  --runtime-image-env deploy/runtime-image.env \\
  --output-dir <absolute-new-empty-production-backup-output-dir> \\
  --preflight-only
\`\`\`

Production capture command shape:

\`\`\`bash
cd /opt/habersoft-rss
<approved-ms-019c-handoff-v2-dir>/capture-production-postgres-backup.sh \\
  --repository-dir /opt/habersoft-rss \\
  --compose-file deploy/production/compose.yaml \\
  --shared-env .env.production \\
  --runtime-image-env deploy/runtime-image.env \\
  --output-dir <absolute-new-empty-production-backup-output-dir>
\`\`\`

The output directory must be absolute, new or empty, outside the repository checkout, and must not reuse any failed prior output directory. It must be transferred through an operator-approved secure channel. Extract the exact returned files flat into the local external intake directory for the next Codex resume. Do not put a ZIP/archive in the canonical intake directory.

Do not use bash -x or set -x. If preflight fails, report only the safe MS019C_PREFLIGHT_FAILED class. Do not paste or upload backup bytes, DB URLs, passwords, raw metadata, raw stderr, raw PostgreSQL output, row data or secrets.

Generated at UTC: ${generatedAt}
`;
}

function validateManifest(manifest, checksumMap) {
  assert(manifest.schema_version === 1, "manifest schema mismatch");
  assert(manifest.bundle_type === "production-backup-restore-handoff", "manifest bundle type mismatch");
  assert(manifest.contract_version === CONTRACT_VERSION, "manifest contract mismatch");
  assert(manifest.milestone === MILESTONE, "manifest milestone mismatch");
  assert(manifest.service === RELEASE_IDENTITY.application, "manifest service mismatch");
  assert(manifest.canonical_remote === CANONICAL_REMOTE, "manifest canonical remote mismatch");
  assert(manifest.dependency_mode === DEPENDENCY_MODE, "manifest dependency mode mismatch");
  assert(manifest.required_landed_commit === manifest.generation_source_commit, "manifest required commit mismatch");
  assert(manifest.core_cli_contract_version === CONTRACT_VERSION, "manifest core CLI contract mismatch");
  assert(manifest.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "manifest parent receipt mismatch");
  assert(manifest.backup_format === "POSTGRESQL_CUSTOM", "manifest backup format mismatch");
  assert(manifest.postgres_image === POSTGRES_IMAGE, "manifest PostgreSQL image mismatch");
  assertSameArray(manifest.expected_tables, [...CANONICAL_TABLES], "manifest table inventory mismatch");
  assertSameArray(manifest.expected_migrations, [...EXPECTED_MIGRATIONS], "manifest migration inventory mismatch");
  assert(isGitSha(manifest.generation_source_commit), "manifest source commit malformed");
  assert(manifest.capture_script?.filename === CAPTURE_BUNDLE, "manifest capture script mismatch");
  assert(manifest.capture_script.sha256 === checksumMap.get(CAPTURE_BUNDLE), "manifest capture script checksum mismatch");
  assert(manifest.capture_script.preflight_only_supported === true, "manifest capture preflight mismatch");
  assert(manifest.restore_wrapper?.filename === RESTORE_BUNDLE, "manifest restore wrapper mismatch");
  assert(manifest.restore_wrapper.sha256 === checksumMap.get(RESTORE_BUNDLE), "manifest restore wrapper checksum mismatch");
  assert(manifest.restore_wrapper.preflight_only_supported === true, "manifest restore preflight mismatch");
  assert(manifest.repository_tooling_lock?.filename === TOOLING_LOCK, "manifest tooling lock mismatch");
  assert(manifest.repository_tooling_lock.sha256 === checksumMap.get(TOOLING_LOCK), "manifest tooling lock checksum mismatch");
  assert(manifest.repository_tooling_lock.required_file_count === REQUIRED_TOOL_FILES.length, "manifest tooling lock file count mismatch");
  assert(manifest.core_backup_script?.path === "scripts/production-backup.mjs", "manifest core backup path mismatch");
  assert(isSha256(manifest.core_backup_script?.sha256), "manifest core backup SHA malformed");
  assert(manifest.restore_verifier_script?.path === "scripts/production-restore-verify.mjs", "manifest restore verifier path mismatch");
  assert(isSha256(manifest.restore_verifier_script?.sha256), "manifest restore verifier SHA malformed");
  for (const key of [
    "production_contact_performed",
    "production_mutation_performed",
    "deployment_performed",
    "migration_performed",
    "backup_performed",
    "restore_performed",
    "artifact_publication_performed",
    "git_tag_created",
    "github_release_created",
    "secrets_included"
  ]) {
    assert(manifest[key] === false, `manifest ${key} must be false`);
  }
}

function validateContract(contract) {
  assert(contract.schema_version === 1, "contract schema mismatch");
  assert(contract.contract_version === CONTRACT_VERSION, "contract version mismatch");
  assert(contract.dependency_mode === DEPENDENCY_MODE, "contract dependency mode mismatch");
  assert(contract.core_cli_contract_version === CONTRACT_VERSION, "contract core CLI contract mismatch");
  assert(contract.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "contract parent receipt mismatch");
  assert(contract.repository_tooling?.global_worktree_clean_required === false, "contract worktree cleanliness mismatch");
  assert(contract.repository_tooling?.required_tool_files_must_match_sha256 === true, "contract tool hash guard mismatch");
  assert(contract.repository_tooling?.required_tool_files_must_be_unmodified === true, "contract dirty tool guard mismatch");
  assert(contract.wrapper_interfaces?.capture?.output_dir_maps_to_core_bundle_mode === true, "contract capture mapping mismatch");
  assert(contract.wrapper_interfaces?.capture?.unsupported_output_flag === "--output", "contract capture unsupported output flag mismatch");
  assert(contract.backup_capture?.format === "POSTGRESQL_CUSTOM", "contract backup format mismatch");
  assert(contract.backup_capture?.compose_context_mode === "EXPLICIT_PRODUCTION_COMPOSE_TWO_ENV_FILES", "contract compose mode mismatch");
  assert(contract.backup_capture?.preflight_only_supported === true, "contract capture preflight mismatch");
  assert(contract.off_host_restore?.postgres_image === POSTGRES_IMAGE, "contract PostgreSQL image mismatch");
  assertSameArray(contract.off_host_restore?.expected_tables, [...CANONICAL_TABLES], "contract tables mismatch");
  assertSameArray(contract.off_host_restore?.expected_migrations, [...EXPECTED_MIGRATIONS], "contract migrations mismatch");
}

function validateToolingLock(lock) {
  assert(lock.schema_version === 1, "tooling lock schema mismatch");
  assert(lock.lock_type === "production-backup-restore-repository-tooling-lock", "tooling lock type mismatch");
  assert(lock.milestone === MILESTONE, "tooling lock milestone mismatch");
  assert(lock.dependency_mode === DEPENDENCY_MODE, "tooling lock dependency mode mismatch");
  assert(lock.canonical_remote === CANONICAL_REMOTE, "tooling lock canonical remote mismatch");
  assert(isGitSha(lock.required_landed_commit), "tooling lock required commit malformed");
  assert(lock.core_cli_contract_version === CONTRACT_VERSION, "tooling lock contract mismatch");
  assert(lock.package_script_identities?.backup === "production:backup", "tooling lock backup script identity mismatch");
  assert(lock.package_script_identities?.restore_verify === "production:restore:verify", "tooling lock restore script identity mismatch");
  assert(lock.global_worktree_clean_required === false, "tooling lock worktree cleanliness mismatch");
  assert(lock.required_tool_files_must_be_unmodified === true, "tooling lock dirty tool guard mismatch");
  assertSameArray((lock.required_files ?? []).map((file) => file.path), REQUIRED_TOOL_FILES, "tooling lock file inventory mismatch");
  for (const file of lock.required_files ?? []) {
    assert(REQUIRED_TOOL_FILES.includes(file.path), "tooling lock unexpected file");
    assert(isSha256(file.sha256), `tooling lock SHA malformed for ${file.path}`);
  }
  for (const key of [
    "production_contact_performed",
    "production_mutation_performed",
    "secrets_included"
  ]) {
    assert(lock[key] === false, `tooling lock ${key} must be false`);
  }
}

function assertExactFiles(directory, expected) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  assertSameArray(names, [...expected].sort(), `unexpected inventory: ${names.join(",")}`);
  for (const entry of entries) {
    const stat = lstatSync(path.join(directory, entry.name));
    assert(stat.isFile(), `entry must be a file: ${entry.name}`);
    assert(!entry.name.endsWith(".zip") && !entry.name.endsWith(".tar"), "inventory must not include archive");
  }
}

function readCaptureBundleEvidence(directory) {
  assert(existsSync(directory) && statSync(directory).isDirectory(), "capture-dir must be an existing directory");
  assertExactFiles(directory, CAPTURE_BUNDLE_FILES);
  verifyChecksums(directory, CAPTURE_CHECKSUM_FILES);
  const dumpPath = path.join(directory, DUMP_FILENAME);
  assertCustomDump(dumpPath);
  const dumpBytes = readFileSync(dumpPath);
  const metadata = readJson(path.join(directory, METADATA_FILENAME));
  const captureReceipt = readJson(path.join(directory, CAPTURE_RECEIPT_FILENAME));
  assert(metadata.contract_version === CONTRACT_VERSION, "metadata contract mismatch");
  assert(captureReceipt.contract_version === CONTRACT_VERSION, "capture receipt contract mismatch");
  assert(captureReceipt.receipt_type === "production-backup-capture", "capture receipt type mismatch");
  assert(metadata.backup_sha256 === sha256(dumpBytes), "metadata backup SHA mismatch");
  assert(captureReceipt.backup?.sha256 === sha256(dumpBytes), "capture receipt backup SHA mismatch");
  assert(metadata.backup_bytes === dumpBytes.length, "metadata backup size mismatch");
  assert(captureReceipt.backup?.bytes === dumpBytes.length, "capture receipt backup size mismatch");
  assert(captureReceipt.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "parent MS-019B receipt mismatch");
  assert(captureReceipt.production_mutation_performed === false, "capture receipt mutation flag must be false");
  assert(captureReceipt.restore_performed === false, "capture receipt restore flag must be false");
  scanTextForSecrets(JSON.stringify(metadata), "metadata");
  scanTextForSecrets(JSON.stringify(captureReceipt), "capture receipt");
  const fileInventory = CAPTURE_BUNDLE_FILES.map((file) => fileMetadata(directory, file));
  return {
    fileInventory,
    treeDigestSha256: treeDigest(fileInventory),
    checksumsSha256: sha256(readFileSync(path.join(directory, CHECKSUMS_FILENAME))),
    metadataSha256: sha256(readFileSync(path.join(directory, METADATA_FILENAME))),
    captureReceiptSha256: sha256(readFileSync(path.join(directory, CAPTURE_RECEIPT_FILENAME))),
    backupSha256: sha256(dumpBytes),
    backupBytes: dumpBytes.length,
    metadata,
    captureReceipt
  };
}

function verifyChecksums(directory, files) {
  const lines = readText(path.join(directory, CHECKSUMS_FILENAME))
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line !== "");
  const map = new Map(lines.map((line) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    assert(match !== null, "checksum line malformed");
    return [match[2], match[1]];
  }));
  for (const file of files) {
    assert(map.get(file) === sha256(readFileSync(path.join(directory, file))), `checksum mismatch for ${file}`);
  }
  assert(map.size === files.length, "checksum file must cover exact payload files");
  return map;
}

function assertCustomDump(file) {
  const bytes = readFileSync(file);
  assert(bytes.length >= 5, "backup dump is too small");
  assert(bytes.subarray(0, 5).toString("ascii") === "PGDMP", "backup is not a PostgreSQL custom-format dump");
}

function treeDigest(fileInventory) {
  const lines = fileInventory
    .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`)
    .join("\n");
  return sha256(Buffer.from(`${lines}\n`, "utf8"));
}

function scanShellForForbiddenCommands(text, label) {
  const forbidden = [
    /\b(?:bash\s+-x|set\s+-x)\b/iu,
    /\bdocker\s+compose\b[\s\S]*(?:\bup\b|\bdown\b|\brestart\b|\brun\b|\brm\b|\bstop\b|\bkill\b)/iu,
    /\bdocker\s+(?:system|volume)\s+prune\b/iu,
    /\bprisma\s+db\s+push\b/iu,
    /\b(printenv|env|set)\b.*(?:DATABASE|POSTGRES|AGENT|TOKEN|SECRET)/iu,
    /\bcat\b.*\.env/iu,
    /\blogs\b/iu
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${label} contains forbidden shell command`);
  }
}

function scanTextForSecrets(text, label) {
  const forbidden = [
    /DATABASE_URL\s*=/iu,
    /POSTGRES_PASSWORD\s*=/iu,
    /TENANT_RATE_LIMIT_KEY_SECRET\s*=/iu,
    /AGENT_KEY\s*=/iu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /Bearer\s+[A-Za-z0-9._-]+/u,
    /"(?:feed_url|feed_title|entry_title|entry_content|tenant_id|raw_sql|dump_bytes)"\s*:/iu
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${label} contains forbidden sensitive content`);
  }
}

function assertNoPrivateLocatorText(text, label) {
  const forbidden = [
    /[A-Za-z]:\\/u,
    /\/home\//u,
    /\/Users\//u,
    /\b(?:ssh|tcp|npipe|unix):\/\//iu,
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/u
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${label} contains forbidden private locator`);
  }
}

function assertBashSyntax(file, label) {
  const result = spawnSync("bash", ["-n", toBashPath(file)], { encoding: "utf8", shell: false });
  assert(result.status === 0, `${label} bash -n failed`);
}

function prepareEmptyOutputDir(outputDir) {
  const relative = path.relative(process.cwd(), outputDir);
  assert(relative.startsWith("..") || path.isAbsolute(relative), "handoff output must be outside the repository");
  if (existsSync(outputDir)) {
    assert(statSync(outputDir).isDirectory(), "output must be a directory");
    assert(readdirSync(outputDir).length === 0, "output must be empty");
    return;
  }
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
}

function writeChecksums(directory, files) {
  const lines = files.map((file) => `${sha256(readFileSync(path.join(directory, file)))}  ${file}`);
  writeText(path.join(directory, "checksums.sha256"), `${lines.join("\n")}\n`, 0o644);
}

function fileMetadata(directory, file) {
  const fullPath = path.join(directory, file);
  return {
    path: file,
    bytes: statSync(fullPath).size,
    sha256: sha256(readFileSync(fullPath))
  };
}

function readText(file) {
  return readFileSync(file, "utf8");
}

function writeText(file, text, mode) {
  writeFileSync(file, text.replace(/\r\n/gu, "\n"), { mode });
  if (process.platform !== "win32" && (mode & 0o111) !== 0) {
    chmodSync(file, mode);
  }
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function writeJson(file, value, mode) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function writeJsonNew(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: "wx" });
}

function externalPath(value, label) {
  assert(value !== undefined && value !== "", `${label} is required`);
  return path.resolve(value);
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    result[key] = next === undefined || next.startsWith("--") ? "true" : next;
    if (result[key] !== "true") {
      index += 1;
    }
  }
  return result;
}

function gitOutput(gitArgs) {
  const result = spawnSync("git", gitArgs, { encoding: "utf8", shell: false });
  assert(result.status === 0, "git command failed");
  return result.stdout.trim();
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/u.test(String(value ?? ""));
}

function isGitSha(value) {
  return /^[a-f0-9]{40}$/u.test(String(value ?? ""));
}

function assertOptionalSha(value, message) {
  assert(value === undefined || isSha256(value), message);
}

function assertOptionalGitSha(value, message) {
  assert(value === undefined || isGitSha(value), message);
}

function assertSameArray(actual, expected, message) {
  assert(JSON.stringify([...(actual ?? [])].sort()) === JSON.stringify([...expected].sort()), message);
}

function toBashPath(file) {
  const resolved = path.resolve(file);
  const driveMatch = /^([A-Za-z]):\\(.*)$/u.exec(resolved);
  if (driveMatch !== null) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replaceAll("\\", "/")}`;
  }
  return resolved.replaceAll(path.sep, "/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error(`production-backup-restore-evidence: ${message}`);
  process.exit(1);
}
