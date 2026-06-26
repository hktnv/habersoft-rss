#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_IDENTITY } from './release-identity.mjs';

const CONTRACT_VERSION = 'production-operational-smoke-evidence-v2';
const FREEZE_SCHEMA_VERSION = 'production-operational-smoke-handoff-freeze-v2';
const RECEIPT_SCHEMA_VERSION = 'production-operational-smoke-receipt-v2';
const AUTHORITY_SCHEMA_VERSION = 'production-operational-smoke-returned-authority-v1';
const AUTHORITY_V2_SCHEMA_VERSION = 'production-operational-smoke-returned-authority-v2';
const AUTHORITY_V3_SCHEMA_VERSION = 'production-operational-smoke-returned-authority-v3';
const MILESTONE = 'MS-019F';
const INTAKE_MILESTONE = 'MS-019F-R2';
const REBASELINE_MILESTONE = 'MS-019F-R3';
const FRESH_SUBMISSION_MILESTONE = 'MS-019F-R4';
const SERVICE_NAME = 'main-service';
const CANONICAL_REMOTE = 'https://github.com/hktnv/habersoft-rss';
const CLASSIFIER_MODE = 'STABLE_SEVERITY_PREFIX';
const CLASSIFIER_VERSION = 'production-log-severity-prefix-v1';
const WINDOW_SECONDS = 1200;
const WINDOW_MINUTES = 20;
const PRIMARY_INTERVAL_SECONDS = 60;
const PRIMARY_SAMPLE_COUNT = 21;
const WORKER_INTERVAL_SECONDS = 300;
const WORKER_SAMPLE_COUNT = 5;
const ERROR_BUCKET_SECONDS = 60;
const ERROR_BUCKET_COUNT = 20;
const ERROR_BUCKET_RECORD_COUNT = ERROR_BUCKET_COUNT * 2;
const MAX_SAMPLE_LAG_SECONDS = 15;
const PUBLIC_HOST = 'rss.habersoft.com';
const WINDOW_CLASS = 'BOUNDED_20M_OPERATIONAL_SMOKE';
const LONG_TERM_STABILITY_STATUS = 'NOT_APPLICABLE_BY_GOVERNANCE_DECISION';
const HISTORICAL_V1_SUPERSESSION_CLASS = 'HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN';

const PARENT_RECEIPT_HASHES = Object.freeze({
  ms_018c_basic_acceptance_receipt: '62b0e21bf76f21a5db04698f3d593bf1592d370eef06f50169ab63b2cc3b8163',
  ms_019b_operational_receipt: '3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620',
  ms_019c_backup_restore_receipt: '868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735',
  ms_019d_checkout_pointer_receipt: 'e823ec819d471c8bb3c5052e6def3a6830731058952971675bdd4ae4d1f6c63a',
  ms_019e_edge_body_limit_receipt_v2: 'fabad4a60f1f284379e1cd903b582b53bfd1fcbf93af32e79a94a1efa6377244',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.dirname(REPO_ROOT);
const SOURCE_OBSERVER = path.join(REPO_ROOT, 'scripts', 'production-operational-smoke-observer.sh');
const HANDOFF_OBSERVER = 'observe-production-operational-smoke.sh';
const HANDOFF_CONTRACT = 'operational-smoke-contract.json';
const HANDOFF_FILES = Object.freeze([
  'README.md',
  HANDOFF_OBSERVER,
  HANDOFF_CONTRACT,
  'manifest.json',
  'checksums.sha256',
]);
const HANDOFF_CHECKSUM_FILES = Object.freeze([
  'README.md',
  HANDOFF_OBSERVER,
  HANDOFF_CONTRACT,
  'manifest.json',
]);
const EVIDENCE_FILES = Object.freeze([
  'checksums.sha256',
  'collector-metadata.txt',
  'operational-smoke-samples.tsv',
  'error-signal-buckets.tsv',
]);
const METADATA_KEYS = Object.freeze([
  'schema_version',
  'contract_version',
  'milestone',
  'service',
  'environment',
  'application_version',
  'canonical_remote',
  'source_commit',
  'collector_sha256',
  'started_at_utc',
  'ended_at_utc',
  'elapsed_seconds',
  'window_class',
  'window_seconds',
  'window_minutes',
  'primary_interval_seconds',
  'primary_sample_count',
  'worker_interval_seconds',
  'worker_sample_count',
  'error_bucket_seconds',
  'error_bucket_count',
  'max_sample_lag_seconds',
  'long_term_stability_claim',
  'long_term_stability_status',
  'compose_context_class',
  'api_initial_identity_token',
  'worker_initial_identity_token',
  'api_initial_image_id',
  'worker_initial_image_id',
  'api_initial_restart_count',
  'worker_initial_restart_count',
  'api_initial_started_at',
  'worker_initial_started_at',
  'log_classifier_mode',
  'log_classifier_version',
  'docker_log_driver_class',
  'raw_logs_retained',
  'raw_health_retained',
  'auth_credentials_used',
  'retry',
  'concurrency',
  'production_mutation',
  'deployment_performed',
  'restart_performed',
  'migration_performed',
  'backup_performed',
  'restore_performed',
]);
const OPERATIONAL_SMOKE_SAMPLE_COLUMNS = Object.freeze([
  'sample_index',
  'target_elapsed_seconds',
  'collected_utc',
  'scheduling_lag_seconds',
  'internal_live_result',
  'internal_ready_result',
  'public_live_result',
  'public_ready_result',
  'dependencies_result',
  'tls_result',
  'api_container_result',
  'worker_container_result',
  'compose_context_result',
  'worker_health_due',
  'worker_health_result',
  'safe_result',
  'blocker',
]);
const ERROR_BUCKET_COLUMNS = Object.freeze([
  'bucket_index',
  'service',
  'start_utc',
  'end_utc',
  'classifier_mode',
  'warning_count',
  'error_count',
  'fatal_count',
  'collection_exit_class',
  'coverage_complete',
  'safe_result',
]);
const RECEIPT_TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'milestone',
  'service',
  'environment',
  'generated_at_utc',
  'contract_version',
  'handoff',
  'parent_receipt_hashes',
  'evidence_bundle',
  'observation',
  'health_summary',
  'container_summary',
  'worker_summary',
  'error_signal_summary',
  'safety_flags',
  'bounded_operational_smoke_result',
  'bounded_error_signal_result',
  'long_term_stability_result',
  'outcome',
  'claim_boundary',
]);
const RECEIPT_HANDOFF_KEYS = Object.freeze(['manifest_sha256', 'observer_sha256', 'contract_sha256', 'freeze_sha256']);
const RECEIPT_EVIDENCE_BUNDLE_KEYS = Object.freeze([
  'directory',
  'inventory',
  'tree_digest',
  'checksums_sha256',
  'collector_metadata_sha256',
  'operational_smoke_samples_sha256',
  'error_signal_buckets_sha256',
]);
const RECEIPT_OBSERVATION_KEYS = Object.freeze([
  'started_at_utc',
  'ended_at_utc',
  'elapsed_seconds',
  'window_class',
  'window_seconds',
  'window_minutes',
  'primary_interval_seconds',
  'primary_sample_count',
  'worker_interval_seconds',
  'worker_sample_count',
  'error_bucket_seconds',
  'error_bucket_count',
  'max_sample_lag_seconds',
  'classifier_mode',
  'classifier_version',
  'docker_log_driver_class',
]);
const RECEIPT_HEALTH_KEYS = Object.freeze([
  'expected_count',
  'internal_live_passed',
  'internal_ready_passed',
  'public_live_passed',
  'public_ready_passed',
  'dependency_ready_passed',
  'tls_passed',
]);
const RECEIPT_CONTAINER_KEYS = Object.freeze([
  'api_identity_stable',
  'worker_identity_stable',
  'api_failure_samples',
  'worker_failure_samples',
  'restart_delta',
  'oom_observed',
  'replacement_count',
]);
const RECEIPT_WORKER_KEYS = Object.freeze([
  'expected_count',
  'due_count',
  'passed_count',
  'queue',
  'scheduler',
  'job',
  'timezone',
  'global_concurrency',
  'local_concurrency',
]);
const RECEIPT_ERROR_SIGNAL_KEYS = Object.freeze([
  'classifier_mode',
  'api_bucket_count',
  'worker_bucket_count',
  'coverage_complete',
  'warning_total',
  'error_total',
  'fatal_total',
  'raw_logs_retained',
]);
const RECEIPT_SAFETY_KEYS = Object.freeze([
  'raw_logs_retained',
  'raw_health_retained',
  'auth_credentials_used',
  'retry',
  'concurrency',
  'production_mutation',
  'deployment_performed',
  'restart_performed',
  'migration_performed',
  'backup_performed',
  'restore_performed',
]);
const RECEIPT_CLAIM_BOUNDARY_KEYS = Object.freeze([
  'bounded_operational_smoke_claim',
  'not_long_term_stability_or_slo',
  'long_term_stability_claim',
  'long_term_stability_status',
  'not_zero_historical_errors',
  'historical_previous_pointer_still_not_recorded',
]);
const AUTHORITY_KEYS = Object.freeze([
  'schema_version',
  'record_type',
  'milestone',
  'service',
  'environment',
  'generated_at_utc',
  'submission_kind',
  'authority_source',
  'selected_input_alias',
  'authoritative_tree_digest',
  'authoritative_safe_file_count',
  'safe_inventory',
  'expected_handoff',
  'safety_flags',
]);
const AUTHORITY_FILE_KEYS = Object.freeze([
  'relative_path',
  'file_type',
  'byte_size',
  'sha256',
]);
const AUTHORITY_HANDOFF_KEYS = Object.freeze([
  'source_commit',
  'manifest_sha256',
  'observer_sha256',
  'contract_version',
  'contract_sha256',
  'freeze_sha256',
]);
const AUTHORITY_SAFETY_KEYS = Object.freeze([
  'raw_contents_printed',
  'raw_logs_retained',
  'raw_health_retained',
  'auth_credentials_used',
  'production_contact_performed_by_codex',
  'production_mutation_performed_by_codex',
]);
const AUTHORITY_V2_KEYS = Object.freeze([
  'schema_version',
  'record_type',
  'record_revision',
  'milestone',
  'service',
  'environment',
  'generated_at_utc',
  'authority_source',
  'operator_reported_time_sync_corrected',
  'operator_reported_checksum_updated',
  'checksum_alone_is_duration_evidence',
  'validation_bypass_granted',
  'selected_input_alias',
  'current_tree_digest',
  'current_safe_file_count',
  'current_safe_inventory',
  'old_tree_digest',
  'old_authority_sha256',
  'old_blocked_receipt_sha256',
  'bundle_change_classification',
  'changed_files_from_r2',
  'expected_handoff',
  'parent_receipt_hashes',
  'returned_files_modified_by_codex',
  'codex_production_contact',
  'production_mutation',
]);
const AUTHORITY_V3_KEYS = Object.freeze([
  'schema_version',
  'record_type',
  'record_revision',
  'milestone',
  'service',
  'environment',
  'generated_at_utc',
  'submission_kind',
  'authority_source',
  'selected_input_alias',
  'authoritative_tree_digest',
  'authoritative_safe_file_count',
  'safe_inventory',
  'superseded_historical_identities',
  'expected_handoff',
  'expected_contract_version',
  'parent_receipt_hashes',
  'fresh_run_claim_requires_bundle_validation',
  'validation_bypass_granted',
  'operator_transcript_used_as_evidence',
  'returned_files_modified_by_codex',
  'production_contact_performed_by_codex',
  'production_mutation_performed',
]);
const AUTHORITY_V3_SUPERSEDED_KEYS = Object.freeze([
  'r2_tree_digest',
  'r2_authority_sha256',
  'r2_blocked_receipt_sha256',
  'r3_tree_digest',
  'r3_authority_v2_sha256',
]);
const DEFAULT_HANDOFF_DIR = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'production-operational-smoke-handoff-v2');
const DEFAULT_FREEZE_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'verification', 'handoff-v2-freeze.json');
const DEFAULT_RECEIPT_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'production-operational-smoke-receipt.json');
const DEFAULT_AUTHORITY_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'verification', 'production-operational-smoke-returned-v2-authority.json');
const DEFAULT_AUTHORITY_V2_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'verification', 'production-operational-smoke-returned-v2-authority-v2.json');
const DEFAULT_AUTHORITY_V3_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'verification', 'production-operational-smoke-returned-v3-authority.json');
const DEFAULT_OLD_RECEIPT_FILE = path.join(WORKSPACE_ROOT, 'operator-state', 'ms-019f', 'production-operational-smoke-receipt.json');

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}${os.EOL}`);
    process.exitCode = 1;
  });
}

export {
  classifyLogLines,
  constants,
  createReceiptFromEvidence,
  parseMetadata,
  parseTsv,
  verifyReceiptObject,
  verifySourceContracts,
};

function constants() {
  return {
    CONTRACT_VERSION,
    CLASSIFIER_MODE,
    CLASSIFIER_VERSION,
    WINDOW_SECONDS,
    PRIMARY_INTERVAL_SECONDS,
    PRIMARY_SAMPLE_COUNT,
    WORKER_INTERVAL_SECONDS,
    WORKER_SAMPLE_COUNT,
    ERROR_BUCKET_COUNT,
    ERROR_BUCKET_RECORD_COUNT,
    ERROR_BUCKET_SECONDS,
    WINDOW_MINUTES,
    MAX_SAMPLE_LAG_SECONDS,
    WINDOW_CLASS,
    LONG_TERM_STABILITY_STATUS,
    HISTORICAL_V1_SUPERSESSION_CLASS,
  };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  switch (command) {
    case 'source:verify':
      printJson(verifySourceContracts());
      break;
    case 'handoff':
      printJson(createHandoff(options.handoffDir));
      break;
    case 'handoff:verify':
      printJson(verifyHandoff(options.handoffDir));
      break;
    case 'handoff:freeze':
      printJson(createFreeze(options.handoffDir, options.freezeFile, options.fixtureResult));
      break;
    case 'handoff:freeze:verify':
      printJson(verifyFreeze(options.handoffDir, options.freezeFile));
      break;
    case 'authority:create':
      printJson(createAuthority(options));
      break;
    case 'authority:verify':
      printJson(verifyAuthorityFile(options.authorityFile, options));
      break;
    case 'authority:v2:create':
      printJson(createAuthorityV2(options));
      break;
    case 'authority:v2:verify':
      printJson(verifyAuthorityV2File(authorityV2File(options), options));
      break;
    case 'authority:v3:create':
      printJson(createAuthorityV3(options));
      break;
    case 'authority:v3:verify':
      printJson(verifyAuthorityV3File(authorityV3File(options), options));
      break;
    case 'receipt:create':
      printJson(createReceipt(options));
      break;
    case 'receipt:verify':
      printJson(verifyReceiptFile(options.receiptFile, options));
      break;
    case 'fixture:e2e':
      printJson(runGeneratedHandoffFixture(options));
      break;
    default:
      fail(`usage: production-operational-smoke-evidence <source:verify|handoff|handoff:verify|handoff:freeze|handoff:freeze:verify|authority:create|authority:verify|authority:v2:create|authority:v2:verify|authority:v3:create|authority:v3:verify|receipt:create|receipt:verify|fixture:e2e>`);
  }
}

function parseArgs(rawArgs) {
  const options = {
    handoffDir: DEFAULT_HANDOFF_DIR,
    freezeFile: DEFAULT_FREEZE_FILE,
    receiptFile: DEFAULT_RECEIPT_FILE,
    authorityFile: DEFAULT_AUTHORITY_FILE,
    oldAuthorityFile: DEFAULT_AUTHORITY_FILE,
    oldAuthorityV2File: DEFAULT_AUTHORITY_V2_FILE,
    oldReceiptFile: DEFAULT_OLD_RECEIPT_FILE,
    evidenceDir: '',
    fixtureResult: 'NOT_RUN',
    requireBoundedOperationalSmoke: false,
    requireErrorSignalWindow: false,
    requireMs019fV2Baseline: false,
  };
  const positional = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = () => {
      index += 1;
      if (index >= rawArgs.length) {
        fail(`${arg} requires a value`);
      }
      return rawArgs[index];
    };
    switch (arg) {
      case '--output-dir':
      case '--handoff-dir':
        options.handoffDir = path.resolve(next());
        break;
      case '--freeze-file':
        options.freezeFile = path.resolve(next());
        break;
      case '--authority-file':
        options.authorityFile = path.resolve(next());
        break;
      case '--old-authority-file':
        options.oldAuthorityFile = path.resolve(next());
        break;
      case '--old-authority-v2-file':
        options.oldAuthorityV2File = path.resolve(next());
        break;
      case '--old-receipt-file':
        options.oldReceiptFile = path.resolve(next());
        break;
      case '--evidence-dir':
        options.evidenceDir = path.resolve(next());
        break;
      case '--receipt-file':
      case '--output-file':
        options.receiptFile = path.resolve(next());
        break;
      case '--fixture-result':
        options.fixtureResult = next();
        break;
      case '--require-bounded-operational-smoke':
        options.requireBoundedOperationalSmoke = true;
        break;
      case '--require-error-signal-window':
        options.requireErrorSignalWindow = true;
        break;
      case '--require-ms019f-v2-baseline':
        options.requireMs019fV2Baseline = true;
        options.requireBoundedOperationalSmoke = true;
        options.requireErrorSignalWindow = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }
  return { positional, options };
}

function verifySourceContracts() {
  const apiEntry = readText(path.join(REPO_ROOT, 'src', 'bootstrap', 'api-entrypoint.ts'));
  const workerEntry = readText(path.join(REPO_ROOT, 'src', 'bootstrap', 'worker-entrypoint.ts'));
  const bootstrapError = readText(path.join(REPO_ROOT, 'src', 'bootstrap', 'bootstrap-error.ts'));
  const mainApi = readText(path.join(REPO_ROOT, 'src', 'main-api.ts'));
  const mainWorker = readText(path.join(REPO_ROOT, 'src', 'main-worker.ts'));
  const jwksCache = readText(path.join(REPO_ROOT, 'src', 'tenant-auth', 'jwks-cache.service.ts'));
  const cleanupTelemetry = readText(path.join(REPO_ROOT, 'src', 'maintenance', 'cleanup.telemetry.ts'));
  const workerHealth = readText(path.join(REPO_ROOT, 'src', 'worker', 'worker-health-entrypoint.ts'));
  const registry = readText(path.join(REPO_ROOT, 'src', 'maintenance', 'maintenance.registry.ts'));
  const healthController = readText(path.join(REPO_ROOT, 'src', 'health', 'health.controller.ts'));
  const healthService = readText(path.join(REPO_ROOT, 'src', 'health', 'health.service.ts'));
  const productionCompose = readText(path.join(REPO_ROOT, 'deploy', 'production', 'compose.yaml'));

  assert(apiEntry.includes('NestFactory') && apiEntry.includes('nestFactory.create') && apiEntry.includes('bufferLogs: true'), 'API bootstrap logger contract changed');
  assert(workerEntry.includes('NestFactory') && workerEntry.includes('nestFactory.createApplicationContext') && workerEntry.includes('bufferLogs: true'), 'worker bootstrap logger contract changed');
  assert(mainApi.includes('reportBootstrapFailure("main-service-api"'), 'API bootstrap failure prefix changed');
  assert(mainWorker.includes('reportBootstrapFailure("main-service-worker"'), 'worker bootstrap failure prefix changed');
  assert(bootstrapError.includes('console.error(error.message)') && bootstrapError.includes('console.error(`${processName} bootstrap failed`)'), 'bootstrap error emission changed');
  assert(jwksCache.includes('console.warn(`tenant auth JWKS refresh failed: ${response.reason}`)'), 'JWKS warning prefix changed');
  assert(cleanupTelemetry.includes('console.warn(JSON.stringify({ ...payload, signal: `cleanup_step_failed{step=${result.step}}` }))'), 'cleanup warning signal changed');
  assert(healthController.includes('@Controller("health")') && healthController.includes('@Get("live")') && healthController.includes('@Get("ready")'), 'health routes changed');
  assert(healthService.includes('status: "live"') && healthService.includes('postgres') && healthService.includes('redis') && healthService.includes('tenantAuth'), 'health response contract changed');
  assert(workerHealth.includes('queue.getJobScheduler(CLEANUP_DAILY_SCHEDULER_ID)') && workerHealth.includes('queue.getGlobalConcurrency()'), 'worker health checks changed');
  assert(workerHealth.includes('scheduler?.name !== CLEANUP_RUN_JOB_NAME') && workerHealth.includes('scheduler.pattern !== CLEANUP_DAILY_CRON_PATTERN') && workerHealth.includes('scheduler.tz !== CLEANUP_DAILY_TIMEZONE'), 'worker scheduler proof changed');
  assert(registry.includes('MAINTENANCE_QUEUE_NAME = "main-service.maintenance"'), 'maintenance queue changed');
  assert(registry.includes('CLEANUP_RUN_JOB_NAME = "cleanup.run.v1"'), 'maintenance job changed');
  assert(registry.includes('CLEANUP_DAILY_SCHEDULER_ID = "cleanup.daily"'), 'maintenance scheduler changed');
  assert(registry.includes('CLEANUP_DAILY_TIMEZONE = "UTC"'), 'maintenance timezone changed');
  assert(productionCompose.includes('main-service-api:') && productionCompose.includes('main-service-worker:'), 'production services changed');
  assert(!/\bpino\b|\bwinston\b/u.test(apiEntry + workerEntry + mainApi + mainWorker), 'unexpected logger dependency found in bootstrap');

  return {
    status: 'production-operational-smoke-source-contract-verified',
    classifier_mode: CLASSIFIER_MODE,
    classifier_version: CLASSIFIER_VERSION,
    classifier_source_owner: [
      'src/bootstrap/bootstrap-error.ts',
      'src/tenant-auth/jwks-cache.service.ts',
      'src/maintenance/cleanup.telemetry.ts',
      'Nest default logger severity token',
    ],
    health_source_owner: ['src/health/health.controller.ts', 'src/health/health.service.ts'],
    worker_health_source_owner: ['src/worker/worker-health-entrypoint.ts', 'src/maintenance/maintenance.registry.ts'],
    runtime_logging_changed: false,
    raw_log_retention: false,
  };
}

function classifyLogLines(text) {
  let warning = 0;
  let error = 0;
  let fatal = 0;
  let unsupported = 0;
  for (const rawLine of String(text).split(/\r?\n/u)) {
    if (rawLine === '') {
      continue;
    }
    const line = rawLine.replace(/\u001b\[[0-9;]*m/gu, '');
    if (/^\[Nest\]\s+[0-9]+\s+-\s+.*\sFATAL(?:\s|$)/u.test(line)) {
      fatal += 1;
    } else if (/^\[Nest\]\s+[0-9]+\s+-\s+.*\sERROR(?:\s|$)/u.test(line)) {
      error += 1;
    } else if (/^\[Nest\]\s+[0-9]+\s+-\s+.*\sWARN(?:\s|$)/u.test(line)) {
      warning += 1;
    } else if (/^main-service-(?:api|worker|worker-health) bootstrap failed$/u.test(line)) {
      error += 1;
    } else if (/^Invalid runtime configuration:/u.test(line)) {
      error += 1;
    } else if (/^tenant auth JWKS refresh failed: /u.test(line)) {
      warning += 1;
    } else if (/^\{.*"operation":"cleanup_step".*"status":"failed".*\}$/u.test(line)) {
      warning += 1;
    } else if (/^\{.*"signal":"cleanup_step_failed\{step=[a-z_]+\}".*\}$/u.test(line)) {
      warning += 1;
    } else if (/^\{.*"level"\s*:\s*"(?:error|fatal|warn)".*\}$/iu.test(line)) {
      unsupported += 1;
    }
  }
  return { warning, error, fatal, unsupported };
}

function createHandoff(outputDir) {
  verifySourceContracts();
  ensureEmptyOutputDir(outputDir);
  const sourceCommit = currentGitCommit();
  const observer = readText(SOURCE_OBSERVER).replaceAll('__MS019F_SOURCE_COMMIT__', sourceCommit);
  assertLfOnly('production-operational-smoke-observer.sh', observer);
  staticScanObserver(observer);
  writeText(path.join(outputDir, HANDOFF_OBSERVER), observer, 0o700);
  writeText(path.join(outputDir, 'README.md'), handoffReadme(sourceCommit), 0o600);
  writeJson(path.join(outputDir, HANDOFF_CONTRACT), handoffContract(sourceCommit));
  const observerSha = sha256File(path.join(outputDir, HANDOFF_OBSERVER));
  const contractSha = sha256File(path.join(outputDir, HANDOFF_CONTRACT));
  const manifest = handoffManifest({
    sourceCommit,
    observerSha,
    contractSha,
    generatedAt: new Date().toISOString(),
  });
  writeJson(path.join(outputDir, 'manifest.json'), manifest);
  writeChecksums(outputDir, HANDOFF_CHECKSUM_FILES);
  verifyHandoff(outputDir);
  return {
    status: 'production-operational-smoke-handoff-created',
    handoff_dir: outputDir,
    source_commit: sourceCommit,
    manifest_sha256: sha256File(path.join(outputDir, 'manifest.json')),
    observer_sha256: observerSha,
    contract_sha256: contractSha,
    evidence_collected: false,
  };
}

function verifyHandoff(handoffDir) {
  assertExactInventory(handoffDir, HANDOFF_FILES);
  const checksumMap = verifyChecksums(handoffDir, HANDOFF_CHECKSUM_FILES);
  const readme = readAndValidateTextFile(handoffDir, 'README.md');
  const observer = readAndValidateTextFile(handoffDir, HANDOFF_OBSERVER);
  const contract = JSON.parse(readAndValidateTextFile(handoffDir, HANDOFF_CONTRACT));
  const manifest = JSON.parse(readAndValidateTextFile(handoffDir, 'manifest.json'));
  staticScanObserver(observer);
  assertBashSyntax(path.join(handoffDir, HANDOFF_OBSERVER));
  validateHandoffContract(contract);
  validateHandoffManifest(manifest, checksumMap, contract);
  assert(readme.includes('--confirm-window-minutes 20'), 'README must include pinned window confirmation');
  assert(readme.includes('--confirm-public-host rss.habersoft.com'), 'README must include pinned public host');
  return {
    status: 'production-operational-smoke-handoff-verified',
    handoff_dir: handoffDir,
    source_commit: manifest.final_landed_source_commit,
    manifest_sha256: sha256File(path.join(handoffDir, 'manifest.json')),
    observer_sha256: checksumMap[HANDOFF_OBSERVER],
    contract_sha256: checksumMap[HANDOFF_CONTRACT],
    classifier_mode: manifest.log_classifier.mode,
    production_contact: false,
    production_mutation: false,
  };
}

function createFreeze(handoffDir, freezeFile, fixtureResult) {
  assert(fixtureResult === 'PASSED', 'fixture-result must be PASSED');
  assertNoOverwrite(freezeFile);
  const verified = verifyHandoff(handoffDir);
  const manifest = JSON.parse(readText(path.join(handoffDir, 'manifest.json')));
  const freeze = {
    schema_version: FREEZE_SCHEMA_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    handoff_dir_alias: 'EXTERNAL_MS019F_HANDOFF_V2_DIR',
    inventory: [...HANDOFF_FILES],
    source_commit: manifest.final_landed_source_commit,
    manifest_sha256: verified.manifest_sha256,
    observer_sha256: verified.observer_sha256,
    contract_version: CONTRACT_VERSION,
    contract_sha256: verified.contract_sha256,
    window_class: WINDOW_CLASS,
    window_seconds: WINDOW_SECONDS,
    window_minutes: WINDOW_MINUTES,
    primary_interval_seconds: PRIMARY_INTERVAL_SECONDS,
    primary_sample_count: PRIMARY_SAMPLE_COUNT,
    worker_interval_seconds: WORKER_INTERVAL_SECONDS,
    worker_sample_count: WORKER_SAMPLE_COUNT,
    error_bucket_seconds: ERROR_BUCKET_SECONDS,
    error_bucket_count: ERROR_BUCKET_COUNT,
    max_sample_lag_seconds: MAX_SAMPLE_LAG_SECONDS,
    long_term_stability_status: LONG_TERM_STABILITY_STATUS,
    historical_v1_supersession_class: HISTORICAL_V1_SUPERSESSION_CLASS,
    classifier_mode: CLASSIFIER_MODE,
    classifier_version: CLASSIFIER_VERSION,
    lf_verified: true,
    bash_n_verified: true,
    static_safety_scan: 'PASSED',
    generated_handoff_e2e_fixture_result: fixtureResult,
    evidence_collected: false,
    production_contact_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
  ensureDir(path.dirname(freezeFile));
  writeJson(freezeFile, freeze);
  verifyFreeze(handoffDir, freezeFile);
  return {
    status: 'production-operational-smoke-handoff-freeze-created',
    freeze_file: freezeFile,
    freeze_sha256: sha256File(freezeFile),
    manifest_sha256: freeze.manifest_sha256,
    observer_sha256: freeze.observer_sha256,
    contract_sha256: freeze.contract_sha256,
  };
}

function verifyFreeze(handoffDir, freezeFile) {
  const verified = verifyHandoff(handoffDir);
  const freeze = JSON.parse(readAndValidateTextFile(path.dirname(freezeFile), path.basename(freezeFile)));
  assert(freeze.schema_version === FREEZE_SCHEMA_VERSION, 'freeze schema mismatch');
  assert(freeze.milestone === MILESTONE, 'freeze milestone mismatch');
  assertSameArray(freeze.inventory, [...HANDOFF_FILES], 'freeze inventory mismatch');
  assert(freeze.manifest_sha256 === verified.manifest_sha256, 'freeze manifest SHA mismatch');
  assert(freeze.observer_sha256 === verified.observer_sha256, 'freeze observer SHA mismatch');
  assert(freeze.contract_sha256 === verified.contract_sha256, 'freeze contract SHA mismatch');
  assert(freeze.contract_version === CONTRACT_VERSION, 'freeze contract version mismatch');
  assert(freeze.window_class === WINDOW_CLASS, 'freeze window class mismatch');
  assert(freeze.window_seconds === WINDOW_SECONDS, 'freeze window mismatch');
  assert(freeze.window_minutes === WINDOW_MINUTES, 'freeze window minutes mismatch');
  assert(freeze.primary_sample_count === PRIMARY_SAMPLE_COUNT, 'freeze primary sample count mismatch');
  assert(freeze.worker_sample_count === WORKER_SAMPLE_COUNT, 'freeze worker sample count mismatch');
  assert(freeze.error_bucket_seconds === ERROR_BUCKET_SECONDS, 'freeze error bucket seconds mismatch');
  assert(freeze.error_bucket_count === ERROR_BUCKET_COUNT, 'freeze error bucket count mismatch');
  assert(freeze.max_sample_lag_seconds === MAX_SAMPLE_LAG_SECONDS, 'freeze lag limit mismatch');
  assert(freeze.long_term_stability_status === LONG_TERM_STABILITY_STATUS, 'freeze long-term status mismatch');
  assert(freeze.historical_v1_supersession_class === HISTORICAL_V1_SUPERSESSION_CLASS, 'freeze v1 supersession mismatch');
  assert(freeze.classifier_mode === CLASSIFIER_MODE, 'freeze classifier mode mismatch');
  assert(freeze.lf_verified === true && freeze.bash_n_verified === true, 'freeze LF/bash proof missing');
  assert(freeze.static_safety_scan === 'PASSED', 'freeze static scan mismatch');
  assert(freeze.generated_handoff_e2e_fixture_result === 'PASSED', 'freeze fixture result mismatch');
  assert(freeze.evidence_collected === false, 'freeze must not claim evidence collection');
  assert(freeze.production_contact_performed === false, 'freeze must not claim production contact');
  assert(freeze.production_mutation_performed === false, 'freeze must not claim production mutation');
  return {
    status: 'production-operational-smoke-handoff-freeze-verified',
    freeze_file: freezeFile,
    freeze_sha256: sha256File(freezeFile),
    manifest_sha256: freeze.manifest_sha256,
  };
}

function createAuthority(options) {
  assert(options.evidenceDir !== '', '--evidence-dir is required');
  assertNoOverwrite(options.authorityFile);
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  const authority = createAuthorityFromEvidence(options.evidenceDir, {
    source_commit: handoff.source_commit,
    manifest_sha256: handoff.manifest_sha256,
    observer_sha256: handoff.observer_sha256,
    contract_version: CONTRACT_VERSION,
    contract_sha256: handoff.contract_sha256,
    freeze_sha256: freeze.freeze_sha256,
  });
  ensureDir(path.dirname(options.authorityFile));
  writeJson(options.authorityFile, authority);
  return {
    status: 'production-operational-smoke-returned-authority-created',
    authority_file: options.authorityFile,
    sha256: sha256File(options.authorityFile),
    authoritative_tree_digest: authority.authoritative_tree_digest,
    authoritative_safe_file_count: authority.authoritative_safe_file_count,
  };
}

function verifyAuthorityFile(authorityFile, options) {
  const authority = JSON.parse(readAndValidateTextFile(path.dirname(authorityFile), path.basename(authorityFile)));
  verifyAuthorityObject(authority, options);
  return {
    status: 'production-operational-smoke-returned-authority-verified',
    authority_file: authorityFile,
    sha256: sha256File(authorityFile),
    authoritative_tree_digest: authority.authoritative_tree_digest,
    authoritative_safe_file_count: authority.authoritative_safe_file_count,
  };
}

function createAuthorityFromEvidence(evidenceDir, handoffIdentity) {
  assertExactInventory(evidenceDir, EVIDENCE_FILES);
  const inventory = safeFileInventory(evidenceDir, EVIDENCE_FILES);
  return {
    schema_version: AUTHORITY_SCHEMA_VERSION,
    record_type: 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY',
    milestone: INTAKE_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    submission_kind: 'LANDED_HANDOFF_V2_BOUNDED_20M_OBSERVATION',
    authority_source: 'HUMAN_OPERATOR_EXPLICIT_SUBMISSION',
    selected_input_alias: 'production-operational-smoke-returned-v2',
    authoritative_tree_digest: treeDigest(inventory),
    authoritative_safe_file_count: inventory.length,
    safe_inventory: inventory,
    expected_handoff: handoffIdentity,
    safety_flags: {
      raw_contents_printed: false,
      raw_logs_retained: false,
      raw_health_retained: false,
      auth_credentials_used: false,
      production_contact_performed_by_codex: false,
      production_mutation_performed_by_codex: false,
    },
  };
}

function verifyAuthorityObject(authority, options) {
  assertExactObjectKeys(authority, AUTHORITY_KEYS, 'authority keys');
  assert(authority.schema_version === AUTHORITY_SCHEMA_VERSION, 'authority schema mismatch');
  assert(authority.record_type === 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY', 'authority record type mismatch');
  assert(authority.milestone === INTAKE_MILESTONE, 'authority milestone mismatch');
  assert(authority.service === SERVICE_NAME, 'authority service mismatch');
  assert(authority.environment === 'production', 'authority environment mismatch');
  assert(authority.submission_kind === 'LANDED_HANDOFF_V2_BOUNDED_20M_OBSERVATION', 'authority submission kind mismatch');
  assert(authority.authority_source === 'HUMAN_OPERATOR_EXPLICIT_SUBMISSION', 'authority source mismatch');
  assert(authority.selected_input_alias === 'production-operational-smoke-returned-v2', 'authority selected input alias mismatch');
  assert(new Date(authority.generated_at_utc).toISOString() === authority.generated_at_utc, 'authority generated timestamp malformed');
  assert(Array.isArray(authority.safe_inventory), 'authority safe inventory must be an array');
  assert(authority.authoritative_safe_file_count === EVIDENCE_FILES.length, 'authority safe file count mismatch');
  assert(authority.safe_inventory.length === EVIDENCE_FILES.length, 'authority safe inventory length mismatch');
  for (const item of authority.safe_inventory) {
    assertExactObjectKeys(item, AUTHORITY_FILE_KEYS, 'authority inventory file keys');
    assert(EVIDENCE_FILES.includes(item.relative_path), `authority inventory unknown file: ${item.relative_path}`);
    assert(item.file_type === 'regular', 'authority inventory file type mismatch');
    assert(Number.isInteger(item.byte_size) && item.byte_size >= 0, 'authority inventory byte size malformed');
    assert(/^[a-f0-9]{64}$/u.test(item.sha256), 'authority inventory checksum malformed');
  }
  if (options.skipEvidenceMatch !== true) {
    assertExactInventory(options.evidenceDir, EVIDENCE_FILES);
    const currentInventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
    assertSameObject(authority.safe_inventory, currentInventory, 'authority inventory does not match returned evidence');
    assert(authority.authoritative_tree_digest === treeDigest(currentInventory), 'authority tree digest mismatch');
  }
  assertExactObjectKeys(authority.expected_handoff, AUTHORITY_HANDOFF_KEYS, 'authority handoff keys');
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  assert(authority.expected_handoff.source_commit === handoff.source_commit, 'authority source commit mismatch');
  assert(authority.expected_handoff.manifest_sha256 === handoff.manifest_sha256, 'authority manifest checksum mismatch');
  assert(authority.expected_handoff.observer_sha256 === handoff.observer_sha256, 'authority observer checksum mismatch');
  assert(authority.expected_handoff.contract_version === CONTRACT_VERSION, 'authority contract version mismatch');
  assert(authority.expected_handoff.contract_sha256 === handoff.contract_sha256, 'authority contract checksum mismatch');
  assert(authority.expected_handoff.freeze_sha256 === freeze.freeze_sha256, 'authority freeze checksum mismatch');
  assertExactObjectKeys(authority.safety_flags, AUTHORITY_SAFETY_KEYS, 'authority safety flag keys');
  for (const [key, value] of Object.entries(authority.safety_flags)) {
    assert(value === false, `authority safety flag must be false: ${key}`);
  }
}

function createAuthorityV2(options) {
  assert(options.evidenceDir !== '', '--evidence-dir is required');
  const outputFile = authorityV2File(options);
  assertNoOverwrite(outputFile);
  const authority = createAuthorityV2FromEvidence(options);
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, authority);
  return {
    status: 'production-operational-smoke-returned-authority-v2-created',
    authority_file: outputFile,
    sha256: sha256File(outputFile),
    current_tree_digest: authority.current_tree_digest,
    bundle_change_classification: authority.bundle_change_classification,
    changed_files_from_r2: authority.changed_files_from_r2,
  };
}

function verifyAuthorityV2File(authorityFile, options) {
  const authority = JSON.parse(readAndValidateTextFile(path.dirname(authorityFile), path.basename(authorityFile)));
  verifyAuthorityV2Object(authority, options);
  return {
    status: 'production-operational-smoke-returned-authority-v2-verified',
    authority_file: authorityFile,
    sha256: sha256File(authorityFile),
    current_tree_digest: authority.current_tree_digest,
    bundle_change_classification: authority.bundle_change_classification,
    changed_files_from_r2: authority.changed_files_from_r2,
  };
}

function createAuthorityV2FromEvidence(options) {
  assertExactInventory(options.evidenceDir, EVIDENCE_FILES);
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  const oldAuthority = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityFile), path.basename(options.oldAuthorityFile)));
  verifyAuthorityObject(oldAuthority, { ...options, authorityFile: options.oldAuthorityFile, skipEvidenceMatch: true });
  const currentInventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
  const changedFiles = changedFilesFromOldAuthority(currentInventory, oldAuthority.safe_inventory);
  return {
    schema_version: AUTHORITY_V2_SCHEMA_VERSION,
    record_type: 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY',
    record_revision: 2,
    milestone: REBASELINE_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    authority_source: 'HUMAN_OPERATOR_EXPLICIT_TIME_SYNC_CORRECTION_SUBMISSION',
    operator_reported_time_sync_corrected: true,
    operator_reported_checksum_updated: true,
    checksum_alone_is_duration_evidence: false,
    validation_bypass_granted: false,
    selected_input_alias: 'production-operational-smoke-returned-v2',
    current_tree_digest: treeDigest(currentInventory),
    current_safe_file_count: currentInventory.length,
    current_safe_inventory: currentInventory,
    old_tree_digest: oldAuthority.authoritative_tree_digest,
    old_authority_sha256: sha256File(options.oldAuthorityFile),
    old_blocked_receipt_sha256: sha256File(options.oldReceiptFile),
    bundle_change_classification: classifyBundleChange(changedFiles),
    changed_files_from_r2: changedFiles,
    expected_handoff: {
      source_commit: handoff.source_commit,
      manifest_sha256: handoff.manifest_sha256,
      observer_sha256: handoff.observer_sha256,
      contract_version: CONTRACT_VERSION,
      contract_sha256: handoff.contract_sha256,
      freeze_sha256: freeze.freeze_sha256,
    },
    parent_receipt_hashes: { ...PARENT_RECEIPT_HASHES },
    returned_files_modified_by_codex: false,
    codex_production_contact: false,
    production_mutation: false,
  };
}

function verifyAuthorityV2Object(authority, options) {
  assertExactObjectKeys(authority, AUTHORITY_V2_KEYS, 'authority-v2 keys');
  verifyAuthorityV2StaticFields(authority);
  if (options.skipEvidenceMatch === true) {
    return;
  }
  const currentInventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
  assertSameObject(authority.current_safe_inventory, currentInventory, 'authority-v2 current inventory mismatch');
  assert(authority.current_tree_digest === treeDigest(currentInventory), 'authority-v2 current tree digest mismatch');
  const oldAuthority = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityFile), path.basename(options.oldAuthorityFile)));
  verifyAuthorityObject(oldAuthority, { ...options, skipEvidenceMatch: true });
  const changedFiles = changedFilesFromOldAuthority(currentInventory, oldAuthority.safe_inventory);
  assertSameArray(authority.changed_files_from_r2, changedFiles, 'authority-v2 changed files mismatch');
  assert(authority.bundle_change_classification === classifyBundleChange(changedFiles), 'authority-v2 classification mismatch');
  assert(authority.old_tree_digest === oldAuthority.authoritative_tree_digest, 'authority-v2 old tree digest mismatch');
  assert(authority.old_authority_sha256 === sha256File(options.oldAuthorityFile), 'authority-v2 old authority checksum mismatch');
  assert(authority.old_blocked_receipt_sha256 === sha256File(options.oldReceiptFile), 'authority-v2 old receipt checksum mismatch');
  assertExactObjectKeys(authority.expected_handoff, AUTHORITY_HANDOFF_KEYS, 'authority-v2 handoff keys');
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  assert(authority.expected_handoff.source_commit === handoff.source_commit, 'authority-v2 source commit mismatch');
  assert(authority.expected_handoff.manifest_sha256 === handoff.manifest_sha256, 'authority-v2 manifest checksum mismatch');
  assert(authority.expected_handoff.observer_sha256 === handoff.observer_sha256, 'authority-v2 observer checksum mismatch');
  assert(authority.expected_handoff.contract_version === CONTRACT_VERSION, 'authority-v2 contract version mismatch');
  assert(authority.expected_handoff.contract_sha256 === handoff.contract_sha256, 'authority-v2 contract checksum mismatch');
  assert(authority.expected_handoff.freeze_sha256 === freeze.freeze_sha256, 'authority-v2 freeze checksum mismatch');
  assertSameObject(authority.parent_receipt_hashes, PARENT_RECEIPT_HASHES, 'authority-v2 parent receipt hash mismatch');
  assert(authority.returned_files_modified_by_codex === false, 'authority-v2 returned modification flag mismatch');
  assert(authority.codex_production_contact === false, 'authority-v2 production contact flag mismatch');
  assert(authority.production_mutation === false, 'authority-v2 production mutation flag mismatch');
}

function verifyAuthorityV2StaticFields(authority) {
  assert(authority.schema_version === AUTHORITY_V2_SCHEMA_VERSION, 'authority-v2 schema mismatch');
  assert(authority.record_type === 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY', 'authority-v2 record type mismatch');
  assert(authority.record_revision === 2, 'authority-v2 revision mismatch');
  assert(authority.milestone === REBASELINE_MILESTONE, 'authority-v2 milestone mismatch');
  assert(authority.service === SERVICE_NAME, 'authority-v2 service mismatch');
  assert(authority.environment === 'production', 'authority-v2 environment mismatch');
  assert(new Date(authority.generated_at_utc).toISOString() === authority.generated_at_utc, 'authority-v2 generated timestamp malformed');
  assert(authority.authority_source === 'HUMAN_OPERATOR_EXPLICIT_TIME_SYNC_CORRECTION_SUBMISSION', 'authority-v2 source mismatch');
  assert(authority.operator_reported_time_sync_corrected === true, 'authority-v2 time sync flag mismatch');
  assert(authority.operator_reported_checksum_updated === true, 'authority-v2 checksum flag mismatch');
  assert(authority.checksum_alone_is_duration_evidence === false, 'authority-v2 checksum evidence flag mismatch');
  assert(authority.validation_bypass_granted === false, 'authority-v2 bypass flag mismatch');
  assert(authority.selected_input_alias === 'production-operational-smoke-returned-v2', 'authority-v2 selected input mismatch');
  assert(authority.current_safe_file_count === EVIDENCE_FILES.length, 'authority-v2 file count mismatch');
  assert(Array.isArray(authority.current_safe_inventory), 'authority-v2 inventory must be an array');
  assertExactObjectKeys(authority.expected_handoff, AUTHORITY_HANDOFF_KEYS, 'authority-v2 handoff keys');
  assert(authority.expected_handoff.contract_version === CONTRACT_VERSION, 'authority-v2 contract version mismatch');
  assertSameObject(authority.parent_receipt_hashes, PARENT_RECEIPT_HASHES, 'authority-v2 parent receipt hash mismatch');
  assert(authority.returned_files_modified_by_codex === false, 'authority-v2 returned modification flag mismatch');
  assert(authority.codex_production_contact === false, 'authority-v2 production contact flag mismatch');
  assert(authority.production_mutation === false, 'authority-v2 production mutation flag mismatch');
}

function createAuthorityV3(options) {
  assert(options.evidenceDir !== '', '--evidence-dir is required');
  const outputFile = authorityV3File(options);
  assertNoOverwrite(outputFile);
  const authority = createAuthorityV3FromEvidence(options);
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, authority);
  return {
    status: 'production-operational-smoke-returned-authority-v3-created',
    authority_file: outputFile,
    sha256: sha256File(outputFile),
    authoritative_tree_digest: authority.authoritative_tree_digest,
    authoritative_safe_file_count: authority.authoritative_safe_file_count,
  };
}

function verifyAuthorityV3File(authorityFile, options) {
  const authority = JSON.parse(readAndValidateTextFile(path.dirname(authorityFile), path.basename(authorityFile)));
  verifyAuthorityV3Object(authority, options);
  return {
    status: 'production-operational-smoke-returned-authority-v3-verified',
    authority_file: authorityFile,
    sha256: sha256File(authorityFile),
    authoritative_tree_digest: authority.authoritative_tree_digest,
    authoritative_safe_file_count: authority.authoritative_safe_file_count,
  };
}

function createAuthorityV3FromEvidence(options) {
  assertExactInventory(options.evidenceDir, EVIDENCE_FILES);
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  const oldAuthority = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityFile), path.basename(options.oldAuthorityFile)));
  verifyAuthorityObject(oldAuthority, { ...options, skipEvidenceMatch: true });
  const oldAuthorityV2 = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityV2File), path.basename(options.oldAuthorityV2File)));
  verifyAuthorityV2Object(oldAuthorityV2, { ...options, skipEvidenceMatch: true });
  const inventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
  const currentTreeDigest = treeDigest(inventory);
  assert(currentTreeDigest !== oldAuthority.authoritative_tree_digest, 'fresh returned identity reused R2 tree digest');
  assert(currentTreeDigest !== oldAuthorityV2.current_tree_digest, 'fresh returned identity reused R3 tree digest');
  return {
    schema_version: AUTHORITY_V3_SCHEMA_VERSION,
    record_type: 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY',
    record_revision: 3,
    milestone: FRESH_SUBMISSION_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    submission_kind: 'FRESH_REAL_20M_OBSERVER_RUN',
    authority_source: 'HUMAN_OPERATOR_EXPLICIT_FRESH_SUBMISSION',
    selected_input_alias: 'production-operational-smoke-returned-v3',
    authoritative_tree_digest: currentTreeDigest,
    authoritative_safe_file_count: inventory.length,
    safe_inventory: inventory,
    superseded_historical_identities: {
      r2_tree_digest: oldAuthority.authoritative_tree_digest,
      r2_authority_sha256: sha256File(options.oldAuthorityFile),
      r2_blocked_receipt_sha256: sha256File(options.oldReceiptFile),
      r3_tree_digest: oldAuthorityV2.current_tree_digest,
      r3_authority_v2_sha256: sha256File(options.oldAuthorityV2File),
    },
    expected_handoff: {
      source_commit: handoff.source_commit,
      manifest_sha256: handoff.manifest_sha256,
      observer_sha256: handoff.observer_sha256,
      contract_version: CONTRACT_VERSION,
      contract_sha256: handoff.contract_sha256,
      freeze_sha256: freeze.freeze_sha256,
    },
    expected_contract_version: CONTRACT_VERSION,
    parent_receipt_hashes: { ...PARENT_RECEIPT_HASHES },
    fresh_run_claim_requires_bundle_validation: true,
    validation_bypass_granted: false,
    operator_transcript_used_as_evidence: false,
    returned_files_modified_by_codex: false,
    production_contact_performed_by_codex: false,
    production_mutation_performed: false,
  };
}

function verifyAuthorityV3Object(authority, options) {
  assertExactObjectKeys(authority, AUTHORITY_V3_KEYS, 'authority-v3 keys');
  assert(authority.schema_version === AUTHORITY_V3_SCHEMA_VERSION, 'authority-v3 schema mismatch');
  assert(authority.record_type === 'PRODUCTION_OPERATIONAL_SMOKE_RETURNED_AUTHORITY', 'authority-v3 record type mismatch');
  assert(authority.record_revision === 3, 'authority-v3 revision mismatch');
  assert(authority.milestone === FRESH_SUBMISSION_MILESTONE, 'authority-v3 milestone mismatch');
  assert(authority.service === SERVICE_NAME, 'authority-v3 service mismatch');
  assert(authority.environment === 'production', 'authority-v3 environment mismatch');
  assert(new Date(authority.generated_at_utc).toISOString() === authority.generated_at_utc, 'authority-v3 generated timestamp malformed');
  assert(authority.submission_kind === 'FRESH_REAL_20M_OBSERVER_RUN', 'authority-v3 submission kind mismatch');
  assert(authority.authority_source === 'HUMAN_OPERATOR_EXPLICIT_FRESH_SUBMISSION', 'authority-v3 source mismatch');
  assert(authority.selected_input_alias === 'production-operational-smoke-returned-v3', 'authority-v3 selected input mismatch');
  assert(authority.authoritative_safe_file_count === EVIDENCE_FILES.length, 'authority-v3 file count mismatch');
  const currentInventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
  assertSameObject(authority.safe_inventory, currentInventory, 'authority-v3 inventory mismatch');
  assert(authority.authoritative_tree_digest === treeDigest(currentInventory), 'authority-v3 tree digest mismatch');
  assertExactObjectKeys(authority.superseded_historical_identities, AUTHORITY_V3_SUPERSEDED_KEYS, 'authority-v3 superseded identity keys');
  const oldAuthority = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityFile), path.basename(options.oldAuthorityFile)));
  verifyAuthorityObject(oldAuthority, { ...options, skipEvidenceMatch: true });
  const oldAuthorityV2 = JSON.parse(readAndValidateTextFile(path.dirname(options.oldAuthorityV2File), path.basename(options.oldAuthorityV2File)));
  verifyAuthorityV2Object(oldAuthorityV2, { ...options, skipEvidenceMatch: true });
  assert(authority.superseded_historical_identities.r2_tree_digest === oldAuthority.authoritative_tree_digest, 'authority-v3 R2 tree mismatch');
  assert(authority.superseded_historical_identities.r2_authority_sha256 === sha256File(options.oldAuthorityFile), 'authority-v3 R2 authority checksum mismatch');
  assert(authority.superseded_historical_identities.r2_blocked_receipt_sha256 === sha256File(options.oldReceiptFile), 'authority-v3 R2 receipt checksum mismatch');
  assert(authority.superseded_historical_identities.r3_tree_digest === oldAuthorityV2.current_tree_digest, 'authority-v3 R3 tree mismatch');
  assert(authority.superseded_historical_identities.r3_authority_v2_sha256 === sha256File(options.oldAuthorityV2File), 'authority-v3 R3 authority checksum mismatch');
  assert(authority.authoritative_tree_digest !== oldAuthority.authoritative_tree_digest, 'authority-v3 reused R2 tree digest');
  assert(authority.authoritative_tree_digest !== oldAuthorityV2.current_tree_digest, 'authority-v3 reused R3 tree digest');
  assertExactObjectKeys(authority.expected_handoff, AUTHORITY_HANDOFF_KEYS, 'authority-v3 handoff keys');
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  assert(authority.expected_handoff.source_commit === handoff.source_commit, 'authority-v3 source commit mismatch');
  assert(authority.expected_handoff.manifest_sha256 === handoff.manifest_sha256, 'authority-v3 manifest checksum mismatch');
  assert(authority.expected_handoff.observer_sha256 === handoff.observer_sha256, 'authority-v3 observer checksum mismatch');
  assert(authority.expected_handoff.contract_version === CONTRACT_VERSION, 'authority-v3 contract version mismatch');
  assert(authority.expected_handoff.contract_sha256 === handoff.contract_sha256, 'authority-v3 contract checksum mismatch');
  assert(authority.expected_handoff.freeze_sha256 === freeze.freeze_sha256, 'authority-v3 freeze checksum mismatch');
  assert(authority.expected_contract_version === CONTRACT_VERSION, 'authority-v3 expected contract version mismatch');
  assertSameObject(authority.parent_receipt_hashes, PARENT_RECEIPT_HASHES, 'authority-v3 parent hash mismatch');
  assert(authority.fresh_run_claim_requires_bundle_validation === true, 'authority-v3 validation requirement mismatch');
  assert(authority.validation_bypass_granted === false, 'authority-v3 bypass flag mismatch');
  assert(authority.operator_transcript_used_as_evidence === false, 'authority-v3 transcript flag mismatch');
  assert(authority.returned_files_modified_by_codex === false, 'authority-v3 returned mutation flag mismatch');
  assert(authority.production_contact_performed_by_codex === false, 'authority-v3 production contact flag mismatch');
  assert(authority.production_mutation_performed === false, 'authority-v3 production mutation flag mismatch');
}

function changedFilesFromOldAuthority(currentInventory, oldInventory) {
  const oldByName = Object.fromEntries(oldInventory.map((item) => [item.relative_path, item]));
  return currentInventory
    .filter((item) => oldByName[item.relative_path]?.sha256 !== item.sha256)
    .map((item) => item.relative_path)
    .sort();
}

function classifyBundleChange(changedFiles) {
  if (changedFiles.length === 0) return 'UNCHANGED_BUNDLE';
  if (sameStringArray(changedFiles, ['checksums.sha256'])) return 'CHECKSUM_ONLY_REWRITE';
  if (sameStringArray(changedFiles, ['checksums.sha256', 'collector-metadata.txt'])) return 'METADATA_ONLY_TIME_REWRITE';
  if (changedFiles.some((file) => file === 'operational-smoke-samples.tsv' || file === 'error-signal-buckets.tsv')) {
    return 'SEMANTIC_EVIDENCE_CHANGED';
  }
  return 'SEMANTIC_EVIDENCE_CHANGED';
}

function authorityV2File(options) {
  return options.authorityFile === DEFAULT_AUTHORITY_FILE ? DEFAULT_AUTHORITY_V2_FILE : options.authorityFile;
}

function authorityV3File(options) {
  return options.authorityFile === DEFAULT_AUTHORITY_FILE ? DEFAULT_AUTHORITY_V3_FILE : options.authorityFile;
}

function createReceipt(options) {
  assert(options.evidenceDir !== '', '--evidence-dir is required');
  assertNoOverwrite(options.receiptFile);
  const handoff = verifyHandoff(options.handoffDir);
  const freeze = verifyFreeze(options.handoffDir, options.freezeFile);
  const receipt = createReceiptFromEvidence(options.evidenceDir, {
    handoff_manifest_sha256: handoff.manifest_sha256,
    handoff_observer_sha256: handoff.observer_sha256,
    handoff_contract_sha256: handoff.contract_sha256,
    handoff_freeze_sha256: freeze.freeze_sha256,
  });
  ensureDir(path.dirname(options.receiptFile));
  writeJson(options.receiptFile, receipt);
  return {
    status: 'production-operational-smoke-receipt-created',
    receipt: options.receiptFile,
    sha256: sha256File(options.receiptFile),
    outcome: receipt.outcome,
    operational_smoke_result: receipt.bounded_operational_smoke_result,
    error_signal_result: receipt.bounded_error_signal_result,
    long_term_stability_result: receipt.long_term_stability_result,
  };
}

function verifyReceiptFile(receiptFile, options) {
  const receipt = JSON.parse(readAndValidateTextFile(path.dirname(receiptFile), path.basename(receiptFile)));
  verifyReceiptObject(receipt, options);
  return {
    status: 'production-operational-smoke-receipt-verified',
    receipt: receiptFile,
    sha256: sha256File(receiptFile),
    outcome: receipt.outcome,
    strict_required: Boolean(options.requireBoundedOperationalSmoke || options.requireErrorSignalWindow || options.requireMs019fV2Baseline),
  };
}

function createReceiptFromEvidence(evidenceDir, handoffHashes = {}) {
  assertExactInventory(evidenceDir, EVIDENCE_FILES);
  verifyChecksums(evidenceDir, EVIDENCE_FILES.filter((name) => name !== 'checksums.sha256'));
  const metadata = parseMetadata(readAndValidateTextFile(evidenceDir, 'collector-metadata.txt'));
  const samples = parseTsv(readAndValidateTextFile(evidenceDir, 'operational-smoke-samples.tsv'));
  const buckets = parseTsv(readAndValidateTextFile(evidenceDir, 'error-signal-buckets.tsv'));
  const evidenceInventory = safeFileInventory(evidenceDir, EVIDENCE_FILES);
  const summary = summarizeEvidence(metadata, samples, buckets);
  const outcome = computeOutcome(summary);
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    contract_version: CONTRACT_VERSION,
    handoff: {
      manifest_sha256: handoffHashes.handoff_manifest_sha256 ?? 'NOT_RECORDED',
      observer_sha256: handoffHashes.handoff_observer_sha256 ?? 'NOT_RECORDED',
      contract_sha256: handoffHashes.handoff_contract_sha256 ?? 'NOT_RECORDED',
      freeze_sha256: handoffHashes.handoff_freeze_sha256 ?? 'NOT_RECORDED',
    },
    parent_receipt_hashes: { ...PARENT_RECEIPT_HASHES },
    evidence_bundle: {
      directory: 'EXTERNAL_RETURNED_EVIDENCE_DIR',
      inventory: evidenceInventory,
      tree_digest: treeDigest(evidenceInventory),
      checksums_sha256: sha256File(path.join(evidenceDir, 'checksums.sha256')),
      collector_metadata_sha256: sha256File(path.join(evidenceDir, 'collector-metadata.txt')),
      operational_smoke_samples_sha256: sha256File(path.join(evidenceDir, 'operational-smoke-samples.tsv')),
      error_signal_buckets_sha256: sha256File(path.join(evidenceDir, 'error-signal-buckets.tsv')),
    },
    observation: {
      started_at_utc: metadata.started_at_utc,
      ended_at_utc: metadata.ended_at_utc,
      elapsed_seconds: numberField(metadata.elapsed_seconds, 'elapsed_seconds'),
      window_class: WINDOW_CLASS,
      window_seconds: WINDOW_SECONDS,
      window_minutes: WINDOW_MINUTES,
      primary_interval_seconds: PRIMARY_INTERVAL_SECONDS,
      primary_sample_count: PRIMARY_SAMPLE_COUNT,
      worker_interval_seconds: WORKER_INTERVAL_SECONDS,
      worker_sample_count: WORKER_SAMPLE_COUNT,
      error_bucket_seconds: ERROR_BUCKET_SECONDS,
      error_bucket_count: ERROR_BUCKET_COUNT,
      max_sample_lag_seconds: summary.maxSchedulingLagSeconds,
      classifier_mode: metadata.log_classifier_mode,
      classifier_version: metadata.log_classifier_version,
      docker_log_driver_class: metadata.docker_log_driver_class,
    },
    health_summary: summary.health,
    container_summary: summary.container,
    worker_summary: summary.worker,
    error_signal_summary: summary.errorSignal,
    safety_flags: summary.safety,
    bounded_operational_smoke_result: summary.operationalSmokePass ? 'BOUNDED_OPERATIONAL_SMOKE_WINDOW_VERIFIED' : 'BOUNDED_OPERATIONAL_SMOKE_WINDOW_BLOCKED',
    bounded_error_signal_result: summary.errorSignalPass ? 'NO_ERROR_LEVEL_SIGNALS' : 'ERROR_SIGNAL_WINDOW_BLOCKED',
    long_term_stability_result: LONG_TERM_STABILITY_STATUS,
    outcome,
    claim_boundary: {
      bounded_operational_smoke_claim: 'BOUNDED_20M_OPERATIONAL_SMOKE_AND_ERROR_SIGNAL_WINDOW',
      not_long_term_stability_or_slo: true,
      long_term_stability_claim: false,
      long_term_stability_status: LONG_TERM_STABILITY_STATUS,
      not_zero_historical_errors: true,
      historical_previous_pointer_still_not_recorded: true,
    },
  };
}

function summarizeEvidence(metadata, samples, buckets) {
  assertExactObjectKeys(metadata, METADATA_KEYS, 'metadata keys');
  assert(metadata.contract_version === CONTRACT_VERSION, 'metadata contract version mismatch');
  assert(metadata.milestone === MILESTONE, 'metadata milestone mismatch');
  assert(metadata.service === SERVICE_NAME, 'metadata service mismatch');
  assert(metadata.environment === 'production', 'metadata environment mismatch');
  assert(metadata.canonical_remote === CANONICAL_REMOTE, 'metadata canonical remote mismatch');
  assert(isGitSha(metadata.source_commit), 'metadata source commit malformed');
  assert(/^[a-f0-9]{64}$/u.test(metadata.collector_sha256), 'metadata collector checksum malformed');
  assert(metadata.log_classifier_mode === CLASSIFIER_MODE, 'metadata classifier mode mismatch');
  assert(metadata.log_classifier_version === CLASSIFIER_VERSION, 'metadata classifier version mismatch');
  assert(metadata.window_class === WINDOW_CLASS, 'metadata window class mismatch');
  assert(numberField(metadata.window_seconds, 'window_seconds') === WINDOW_SECONDS, 'metadata window seconds mismatch');
  assert(numberField(metadata.window_minutes, 'window_minutes') === WINDOW_MINUTES, 'metadata window minutes mismatch');
  assert(numberField(metadata.primary_interval_seconds, 'primary_interval_seconds') === PRIMARY_INTERVAL_SECONDS, 'metadata primary interval mismatch');
  assert(numberField(metadata.primary_sample_count, 'primary_sample_count') === PRIMARY_SAMPLE_COUNT, 'metadata primary sample count mismatch');
  assert(numberField(metadata.worker_interval_seconds, 'worker_interval_seconds') === WORKER_INTERVAL_SECONDS, 'metadata worker interval mismatch');
  assert(numberField(metadata.worker_sample_count, 'worker_sample_count') === WORKER_SAMPLE_COUNT, 'metadata worker sample count mismatch');
  assert(numberField(metadata.error_bucket_seconds, 'error_bucket_seconds') === ERROR_BUCKET_SECONDS, 'metadata error bucket seconds mismatch');
  assert(numberField(metadata.error_bucket_count, 'error_bucket_count') === ERROR_BUCKET_COUNT, 'metadata error bucket count mismatch');
  assert(numberField(metadata.max_sample_lag_seconds, 'max_sample_lag_seconds') === MAX_SAMPLE_LAG_SECONDS, 'metadata lag limit mismatch');
  assert(metadata.long_term_stability_claim === 'false', 'metadata long-term stability claim must be false');
  assert(metadata.long_term_stability_status === LONG_TERM_STABILITY_STATUS, 'metadata long-term stability status mismatch');

  assert(samples.length === PRIMARY_SAMPLE_COUNT, `expected ${PRIMARY_SAMPLE_COUNT} operational smoke samples`);
  assert(buckets.length === ERROR_BUCKET_RECORD_COUNT, `expected ${ERROR_BUCKET_RECORD_COUNT} error bucket records`);
  const sampleIndices = new Set();
  let internalLivePassed = 0;
  let internalReadyPassed = 0;
  let publicLivePassed = 0;
  let publicReadyPassed = 0;
  let dependenciesPassed = 0;
  let tlsPassed = 0;
  let apiContainerFailures = 0;
  let workerContainerFailures = 0;
  let workerDueCount = 0;
  let workerPassed = 0;
  let sampleFailures = 0;
  let maxLag = 0;
  const sampleUtcByIndex = Array(PRIMARY_SAMPLE_COUNT).fill(null);
  for (const sample of samples) {
    assertExactObjectKeys(sample, OPERATIONAL_SMOKE_SAMPLE_COLUMNS, 'operational smoke sample columns');
    const index = numberField(sample.sample_index, 'sample_index');
    sampleIndices.add(index);
    if (index < 0 || index >= PRIMARY_SAMPLE_COUNT) {
      fail(`sample index out of range: ${index}`);
    }
    const expectedElapsed = index * PRIMARY_INTERVAL_SECONDS;
    assert(numberField(sample.target_elapsed_seconds, 'target_elapsed_seconds') === expectedElapsed, `sample ${index} target elapsed mismatch`);
    sampleUtcByIndex[index] = parseUtcSecond(sample.collected_utc, `sample ${index} collected UTC`);
    const lag = numberField(sample.scheduling_lag_seconds, 'scheduling_lag_seconds');
    maxLag = Math.max(maxLag, lag);
    if (sample.internal_live_result === 'PASSED') internalLivePassed += 1;
    if (sample.internal_ready_result === 'PASSED') internalReadyPassed += 1;
    if (sample.public_live_result === 'PASSED') publicLivePassed += 1;
    if (sample.public_ready_result === 'PASSED') publicReadyPassed += 1;
    if (sample.dependencies_result === 'PASSED') dependenciesPassed += 1;
    if (sample.tls_result === 'PASSED') tlsPassed += 1;
    if (sample.api_container_result !== 'PASSED') apiContainerFailures += 1;
    if (sample.worker_container_result !== 'PASSED') workerContainerFailures += 1;
    if (sample.worker_health_due === 'true') {
      workerDueCount += 1;
      if (sample.worker_health_result === 'PASSED') workerPassed += 1;
    }
    if (sample.safe_result !== 'PASSED') sampleFailures += 1;
  }
  assert(sampleIndices.size === PRIMARY_SAMPLE_COUNT, 'sample index coverage mismatch');

  const bucketKeys = new Set();
  let warningTotal = 0;
  let errorTotal = 0;
  let fatalTotal = 0;
  let coverageFailures = 0;
  const bucketStartUtcByIndex = Array(ERROR_BUCKET_COUNT).fill(null);
  const bucketEndUtcByIndex = Array(ERROR_BUCKET_COUNT).fill(null);
  for (const bucket of buckets) {
    assertExactObjectKeys(bucket, ERROR_BUCKET_COLUMNS, 'error bucket columns');
    const index = numberField(bucket.bucket_index, 'bucket_index');
    assert(index >= 0 && index < ERROR_BUCKET_COUNT, `bucket index out of range: ${index}`);
    assert(bucket.service === 'api' || bucket.service === 'worker', 'bucket service mismatch');
    assert(bucket.classifier_mode === CLASSIFIER_MODE, 'bucket classifier mismatch');
    const bucketStart = parseUtcSecond(bucket.start_utc, `bucket ${index} ${bucket.service} start UTC`);
    const bucketEnd = parseUtcSecond(bucket.end_utc, `bucket ${index} ${bucket.service} end UTC`);
    assert(bucketEnd - bucketStart === ERROR_BUCKET_SECONDS, `bucket ${index} ${bucket.service} UTC span mismatch`);
    if (bucketStartUtcByIndex[index] === null) {
      bucketStartUtcByIndex[index] = bucketStart;
      bucketEndUtcByIndex[index] = bucketEnd;
    } else {
      assert(bucketStartUtcByIndex[index] === bucketStart, `bucket ${index} service start UTC mismatch`);
      assert(bucketEndUtcByIndex[index] === bucketEnd, `bucket ${index} service end UTC mismatch`);
    }
    const key = `${index}:${bucket.service}`;
    assert(!bucketKeys.has(key), `duplicate bucket key ${key}`);
    bucketKeys.add(key);
    const warnings = numberField(bucket.warning_count, 'warning_count');
    const errors = numberField(bucket.error_count, 'error_count');
    const fatals = numberField(bucket.fatal_count, 'fatal_count');
    warningTotal += warnings;
    errorTotal += errors;
    fatalTotal += fatals;
    if (bucket.coverage_complete !== 'true' || bucket.safe_result !== 'PASSED' || bucket.collection_exit_class !== 'OK') {
      coverageFailures += 1;
    }
  }
  assert(bucketKeys.size === ERROR_BUCKET_RECORD_COUNT, 'bucket coverage mismatch');

  const safety = {
    raw_logs_retained: boolField(metadata.raw_logs_retained, 'raw_logs_retained'),
    raw_health_retained: boolField(metadata.raw_health_retained, 'raw_health_retained'),
    auth_credentials_used: boolField(metadata.auth_credentials_used, 'auth_credentials_used'),
    retry: boolField(metadata.retry, 'retry'),
    concurrency: numberField(metadata.concurrency, 'concurrency'),
    production_mutation: boolField(metadata.production_mutation, 'production_mutation'),
    deployment_performed: boolField(metadata.deployment_performed, 'deployment_performed'),
    restart_performed: boolField(metadata.restart_performed, 'restart_performed'),
    migration_performed: boolField(metadata.migration_performed, 'migration_performed'),
    backup_performed: boolField(metadata.backup_performed, 'backup_performed'),
    restore_performed: boolField(metadata.restore_performed, 'restore_performed'),
  };
  const safetyPass =
    safety.raw_logs_retained === false &&
    safety.raw_health_retained === false &&
    safety.auth_credentials_used === false &&
    safety.retry === false &&
    safety.concurrency === 1 &&
    safety.production_mutation === false &&
    safety.deployment_performed === false &&
    safety.restart_performed === false &&
    safety.migration_performed === false &&
    safety.backup_performed === false &&
    safety.restore_performed === false;
  const elapsedSeconds = numberField(metadata.elapsed_seconds, 'elapsed_seconds');
  const wallClockElapsedSeconds = utcElapsedSeconds(metadata.started_at_utc, metadata.ended_at_utc, 'metadata observation window');
  const metadataStartedSecond = parseUtcSecond(metadata.started_at_utc, 'metadata start UTC');
  const metadataEndedSecond = parseUtcSecond(metadata.ended_at_utc, 'metadata end UTC');
  const firstSampleSecond = sampleUtcByIndex[0];
  const lastSampleSecond = sampleUtcByIndex[PRIMARY_SAMPLE_COUNT - 1];
  const firstBucketStartSecond = bucketStartUtcByIndex[0];
  const lastBucketEndSecond = bucketEndUtcByIndex[ERROR_BUCKET_COUNT - 1];
  const sampleUtcSpanSeconds = lastSampleSecond - firstSampleSecond;
  const bucketUtcSpanSeconds = lastBucketEndSecond - firstBucketStartSecond;
  const timingAlignmentPass =
    wallClockElapsedSeconds === elapsedSeconds &&
    wallClockElapsedSeconds >= WINDOW_SECONDS &&
    sampleUtcSpanSeconds === WINDOW_SECONDS &&
    bucketUtcSpanSeconds === WINDOW_SECONDS &&
    Math.abs(firstSampleSecond - metadataStartedSecond) <= MAX_SAMPLE_LAG_SECONDS &&
    metadataEndedSecond >= lastSampleSecond &&
    metadataEndedSecond - lastSampleSecond <= ERROR_BUCKET_SECONDS &&
    firstBucketStartSecond === firstSampleSecond &&
    lastBucketEndSecond === lastSampleSecond;
  const wallClockPass = timingAlignmentPass;
  const healthPass =
    internalLivePassed === PRIMARY_SAMPLE_COUNT &&
    internalReadyPassed === PRIMARY_SAMPLE_COUNT &&
    publicLivePassed === PRIMARY_SAMPLE_COUNT &&
    publicReadyPassed === PRIMARY_SAMPLE_COUNT &&
    dependenciesPassed === PRIMARY_SAMPLE_COUNT &&
    tlsPassed === PRIMARY_SAMPLE_COUNT;
  const containerPass = apiContainerFailures === 0 && workerContainerFailures === 0;
  const workerPass = workerDueCount === WORKER_SAMPLE_COUNT && workerPassed === WORKER_SAMPLE_COUNT;
  const samplePass =
    samples.length === PRIMARY_SAMPLE_COUNT &&
    sampleFailures === 0 &&
    maxLag <= MAX_SAMPLE_LAG_SECONDS &&
    elapsedSeconds >= WINDOW_SECONDS &&
    wallClockPass;
  const logCoveragePass = coverageFailures === 0;
  const errorSignalPass = logCoveragePass && errorTotal === 0 && fatalTotal === 0;
  const operationalSmokePass = samplePass && healthPass && containerPass && workerPass && safetyPass;
  return {
    operationalSmokePass,
    errorSignalPass,
    maxSchedulingLagSeconds: maxLag,
    health: {
      expected_count: PRIMARY_SAMPLE_COUNT,
      internal_live_passed: internalLivePassed,
      internal_ready_passed: internalReadyPassed,
      public_live_passed: publicLivePassed,
      public_ready_passed: publicReadyPassed,
      dependency_ready_passed: dependenciesPassed,
      tls_passed: tlsPassed,
    },
    container: {
      api_identity_stable: apiContainerFailures === 0,
      worker_identity_stable: workerContainerFailures === 0,
      api_failure_samples: apiContainerFailures,
      worker_failure_samples: workerContainerFailures,
      restart_delta: apiContainerFailures === 0 && workerContainerFailures === 0 ? 0 : 'BLOCKED',
      oom_observed: false,
      replacement_count: 0,
    },
    worker: {
      expected_count: WORKER_SAMPLE_COUNT,
      due_count: workerDueCount,
      passed_count: workerPassed,
      queue: 'main-service.maintenance',
      scheduler: 'cleanup.daily',
      job: 'cleanup.run.v1',
      timezone: 'UTC',
      global_concurrency: 1,
      local_concurrency: 1,
    },
    errorSignal: {
      classifier_mode: CLASSIFIER_MODE,
      api_bucket_count: buckets.filter((bucket) => bucket.service === 'api').length,
      worker_bucket_count: buckets.filter((bucket) => bucket.service === 'worker').length,
      coverage_complete: logCoveragePass,
      warning_total: warningTotal,
      error_total: errorTotal,
      fatal_total: fatalTotal,
      raw_logs_retained: false,
    },
    safety,
    sampleFailures,
    healthPass,
    containerPass,
    workerPass,
    logCoveragePass,
    safetyPass,
    elapsedSeconds,
    wallClockElapsedSeconds,
    wallClockPass,
    sampleUtcSpanSeconds,
    bucketUtcSpanSeconds,
    timingAlignmentPass,
  };
}

function computeOutcome(summary) {
  if (!summary.safetyPass) return 'BLOCKED_EVIDENCE_INTEGRITY';
  if (summary.elapsedSeconds < WINDOW_SECONDS) return 'BLOCKED_SAMPLE_COVERAGE';
  if (!summary.wallClockPass) return 'BLOCKED_SAMPLE_COVERAGE';
  if (summary.maxSchedulingLagSeconds > MAX_SAMPLE_LAG_SECONDS) return 'BLOCKED_SCHEDULING_LAG';
  if (!summary.healthPass) return 'BLOCKED_HEALTH_SAMPLE_FAILURE';
  if (!summary.containerPass) return 'BLOCKED_CONTAINER_RESTART';
  if (!summary.workerPass) return 'BLOCKED_WORKER_HEALTH';
  if (summary.sampleFailures > 0) return 'BLOCKED_SAMPLE_COVERAGE';
  if (!summary.logCoveragePass) return 'BLOCKED_LOG_SIGNAL_COVERAGE';
  if (summary.errorSignal.fatal_total > 0 || summary.errorSignal.error_total > 0) return 'BLOCKED_ERROR_SIGNAL_PRESENT';
  return 'SUCCESS';
}

function verifyReceiptObject(receipt, options = {}) {
  assertExactObjectKeys(receipt, RECEIPT_TOP_LEVEL_KEYS, 'receipt keys');
  assertExactObjectKeys(receipt.handoff, RECEIPT_HANDOFF_KEYS, 'receipt handoff keys');
  assertExactObjectKeys(receipt.evidence_bundle, RECEIPT_EVIDENCE_BUNDLE_KEYS, 'receipt evidence bundle keys');
  assertExactObjectKeys(receipt.observation, RECEIPT_OBSERVATION_KEYS, 'receipt observation keys');
  assertExactObjectKeys(receipt.health_summary, RECEIPT_HEALTH_KEYS, 'receipt health summary keys');
  assertExactObjectKeys(receipt.container_summary, RECEIPT_CONTAINER_KEYS, 'receipt container summary keys');
  assertExactObjectKeys(receipt.worker_summary, RECEIPT_WORKER_KEYS, 'receipt worker summary keys');
  assertExactObjectKeys(receipt.error_signal_summary, RECEIPT_ERROR_SIGNAL_KEYS, 'receipt error signal summary keys');
  assertExactObjectKeys(receipt.safety_flags, RECEIPT_SAFETY_KEYS, 'receipt safety flag keys');
  assertExactObjectKeys(receipt.claim_boundary, RECEIPT_CLAIM_BOUNDARY_KEYS, 'receipt claim boundary keys');
  assert(receipt.schema_version === RECEIPT_SCHEMA_VERSION, 'receipt schema mismatch');
  assert(receipt.milestone === MILESTONE, 'receipt milestone mismatch');
  assert(receipt.service === SERVICE_NAME, 'receipt service mismatch');
  assert(receipt.environment === 'production', 'receipt environment mismatch');
  assert(receipt.contract_version === CONTRACT_VERSION, 'receipt contract mismatch');
  assertSameObject(receipt.parent_receipt_hashes, PARENT_RECEIPT_HASHES, 'parent receipt hashes mismatch');
  assert(receipt.long_term_stability_result === LONG_TERM_STABILITY_STATUS, 'long-term stability result mismatch');
  assert(receipt.claim_boundary.bounded_operational_smoke_claim === 'BOUNDED_20M_OPERATIONAL_SMOKE_AND_ERROR_SIGNAL_WINDOW', 'bounded operational smoke claim mismatch');
  assert(receipt.claim_boundary.not_long_term_stability_or_slo === true, 'long-term/SLO claim boundary mismatch');
  assert(receipt.claim_boundary.long_term_stability_claim === false, 'long-term stability claim must be false');
  assert(receipt.claim_boundary.long_term_stability_status === LONG_TERM_STABILITY_STATUS, 'long-term stability status mismatch');
  assert(receipt.observation.window_seconds === WINDOW_SECONDS, 'receipt window mismatch');
  assert(receipt.observation.window_class === WINDOW_CLASS, 'receipt window class mismatch');
  assert(receipt.observation.window_minutes === WINDOW_MINUTES, 'receipt window minutes mismatch');
  assert(receipt.observation.primary_sample_count === PRIMARY_SAMPLE_COUNT, 'receipt primary sample count mismatch');
  assert(receipt.observation.worker_sample_count === WORKER_SAMPLE_COUNT, 'receipt worker sample count mismatch');
  assert(receipt.observation.error_bucket_seconds === ERROR_BUCKET_SECONDS, 'receipt error bucket seconds mismatch');
  assert(receipt.observation.error_bucket_count === ERROR_BUCKET_COUNT, 'receipt bucket count mismatch');
  assert(receipt.observation.classifier_mode === CLASSIFIER_MODE, 'receipt classifier mismatch');
  const receiptWallClockElapsedSeconds = utcElapsedSeconds(
    receipt.observation.started_at_utc,
    receipt.observation.ended_at_utc,
    'receipt observation window',
  );
  if (receipt.outcome === 'SUCCESS') {
    assert(receiptWallClockElapsedSeconds === receipt.observation.elapsed_seconds, 'successful receipt UTC elapsed mismatch');
    assert(receiptWallClockElapsedSeconds >= WINDOW_SECONDS, 'successful receipt UTC window too short');
  }
  assert(receipt.safety_flags.raw_logs_retained === false, 'raw logs must not be retained');
  assert(receipt.safety_flags.raw_health_retained === false, 'raw health must not be retained');
  assert(receipt.safety_flags.auth_credentials_used === false, 'auth must be false');
  assert(receipt.safety_flags.retry === false, 'retry must be false');
  assert(receipt.safety_flags.concurrency === 1, 'concurrency must be 1');
  assert(receipt.safety_flags.production_mutation === false, 'mutation must be false');
  if (options.requireBoundedOperationalSmoke) {
    assert(receipt.outcome === 'SUCCESS', 'strict operational smoke requires SUCCESS');
    assert(receipt.bounded_operational_smoke_result === 'BOUNDED_OPERATIONAL_SMOKE_WINDOW_VERIFIED', 'bounded operational smoke result mismatch');
    assert(receipt.observation.elapsed_seconds >= WINDOW_SECONDS, 'elapsed window too short');
    assert(receiptWallClockElapsedSeconds === receipt.observation.elapsed_seconds, 'UTC elapsed mismatch');
    assert(receiptWallClockElapsedSeconds >= WINDOW_SECONDS, 'UTC window too short');
    assert(receipt.observation.max_sample_lag_seconds <= MAX_SAMPLE_LAG_SECONDS, 'scheduling lag exceeded');
    assert(receipt.health_summary.internal_live_passed === PRIMARY_SAMPLE_COUNT, 'internal live coverage mismatch');
    assert(receipt.health_summary.public_ready_passed === PRIMARY_SAMPLE_COUNT, 'public ready coverage mismatch');
    assert(receipt.container_summary.api_identity_stable === true, 'API identity not stable');
    assert(receipt.container_summary.worker_identity_stable === true, 'worker identity not stable');
    assert(receipt.worker_summary.passed_count === WORKER_SAMPLE_COUNT, 'worker health coverage mismatch');
  }
  if (options.requireErrorSignalWindow) {
    assert(receipt.outcome === 'SUCCESS', 'strict error signal requires SUCCESS');
    assert(receipt.bounded_error_signal_result === 'NO_ERROR_LEVEL_SIGNALS', 'error signal result mismatch');
    assert(receipt.error_signal_summary.coverage_complete === true, 'log coverage incomplete');
    assert(receipt.error_signal_summary.error_total === 0, 'error signal present');
    assert(receipt.error_signal_summary.fatal_total === 0, 'fatal signal present');
  }
}

function runGeneratedHandoffFixture(options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms019f-handoff-fixture-'));
  try {
    const handoffDir = path.join(root, 'handoff');
    const returnedDir = path.join(root, 'returned');
    const freezeFile = path.join(root, 'freeze.json');
    const wrapperFile = path.join(root, 'run-observer-fixture.sh');
    createHandoff(handoffDir);
    const verify = verifyHandoff(handoffDir);
    writeText(wrapperFile, '#!/usr/bin/env bash\nset -eu\nMS019F_TEST_MODE=1 "$@"\n', 0o700);
    const observerArgs = [
      bashPathArg(path.join(handoffDir, HANDOFF_OBSERVER)),
      '--repository-dir',
      bashPathArg(REPO_ROOT),
      '--compose-file',
      'deploy/production/compose.yaml',
      '--shared-env',
      '.env.production.fixture',
      '--runtime-image-env',
      'deploy/runtime-image.env.fixture',
      '--confirm-window-minutes',
      '20',
      '--confirm-public-host',
      PUBLIC_HOST,
      '--output-dir',
      bashPathArg(returnedDir),
    ];
    const result = spawnSync(
      process.platform === 'win32' ? 'bash.exe' : 'bash',
      [bashPathArg(wrapperFile), ...observerArgs],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: process.env,
      },
    );
    if (result.status !== 0) {
      fail(`generated observer fixture failed: ${result.stderr || result.stdout}`);
    }
    const receiptFile = path.join(root, 'receipt.json');
    createFreeze(handoffDir, freezeFile, 'PASSED');
    createReceipt({
      ...options,
      handoffDir,
      freezeFile,
      evidenceDir: returnedDir,
      receiptFile,
    });
    verifyReceiptFile(receiptFile, {
      requireBoundedOperationalSmoke: true,
      requireErrorSignalWindow: true,
      requireMs019fV2Baseline: true,
    });
    const returnedNames = fs.readdirSync(returnedDir).sort();
    assertSameArray(returnedNames, [...EVIDENCE_FILES].sort(), 'fixture returned inventory mismatch');
    for (const name of returnedNames) {
      const text = readText(path.join(returnedDir, name));
      assert(!/stack trace|DATABASE_URL|POSTGRES_PASSWORD|AGENT_KEY|TENANT_RATE_LIMIT_KEY_SECRET|raw log|docker inspect json/iu.test(text), `fixture leaked unsafe content in ${name}`);
    }
    return {
      status: 'production-operational-smoke-generated-handoff-e2e-passed',
      handoff_manifest_sha256: verify.manifest_sha256,
      returned_inventory: returnedNames,
      receipt_sha256: sha256File(receiptFile),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function handoffReadme(sourceCommit) {
  return `# MS-019F Production Operational Smoke Handoff v2

This bundle prepares a read-only bounded 20-minute operational smoke for main-service.
It does not prove long-term stability, an uptime SLO, or historical error absence,
and it does not authorize deployment, restart, environment edits, migration,
backup, restore, or raw log review.

Historical handoff-v1 is classified as ${HISTORICAL_V1_SUPERSESSION_CLASS}.
It must not be run for fresh evidence.

## Verify This Bundle

\`\`\`bash
cd <approved-ms-019f-handoff-v2-dir>
sha256sum -c checksums.sha256
bash -n observe-production-operational-smoke.sh
\`\`\`

## Run The Observer

Run from a durable operator-owned foreground/session context. Do not use bash -x.
Do not deploy, restart, recreate containers, edit env files, or change the edge
while the 20-minute smoke window is running.

\`\`\`bash
cd /opt/habersoft-rss

<approved-ms-019f-handoff-v2-dir>/observe-production-operational-smoke.sh \\
  --repository-dir /opt/habersoft-rss \\
  --compose-file deploy/production/compose.yaml \\
  --shared-env .env.production \\
  --runtime-image-env deploy/runtime-image.env \\
  --confirm-window-minutes 20 \\
  --confirm-public-host rss.habersoft.com \\
  --output-dir <new-empty-output-dir>
\`\`\`

The output directory must be new or empty. Interrupted runs do not create a valid
checksummed final bundle and must be rerun from the beginning.

Return exactly these files, flat, with no ZIP archive:

- checksums.sha256
- collector-metadata.txt
- operational-smoke-samples.tsv
- error-signal-buckets.tsv

Do not return raw logs, response bodies, screenshots, env files, runtime-image.env,
private host data, Docker inspect JSON, or unknown files.

Generated from source commit \`${sourceCommit}\`.
`;
}

function handoffContract(sourceCommit) {
  return {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    canonical_remote: CANONICAL_REMOTE,
    generated_from_commit: sourceCommit,
    observation: {
      evidence_class: WINDOW_CLASS,
      window_seconds: WINDOW_SECONDS,
      window_minutes: WINDOW_MINUTES,
      confirm_window_minutes: 20,
      primary_interval_seconds: PRIMARY_INTERVAL_SECONDS,
      primary_sample_count: PRIMARY_SAMPLE_COUNT,
      primary_sample_indices: '0..20',
      worker_interval_seconds: WORKER_INTERVAL_SECONDS,
      worker_sample_count: WORKER_SAMPLE_COUNT,
      worker_sample_indices: '0..4',
      error_bucket_seconds: ERROR_BUCKET_SECONDS,
      error_bucket_count: ERROR_BUCKET_COUNT,
      max_sample_lag_seconds: MAX_SAMPLE_LAG_SECONDS,
      retry: false,
      concurrency: 1,
    },
    governance_boundary: {
      long_term_stability_claim: false,
      long_term_stability_status: LONG_TERM_STABILITY_STATUS,
      historical_v1_supersession_class: HISTORICAL_V1_SUPERSESSION_CLASS,
    },
    health_routes: [
      'GET http://127.0.0.1:3200/health/live',
      'GET http://127.0.0.1:3200/health/ready',
      'GET https://rss.habersoft.com/health/live',
      'GET https://rss.habersoft.com/health/ready',
    ],
    expected_services: ['main-service-api', 'main-service-worker'],
    worker_health_contract: {
      command_mode: 'docker compose exec -T main-service-worker npm run worker:health',
      queue: 'main-service.maintenance',
      scheduler: 'cleanup.daily',
      job: 'cleanup.run.v1',
      timezone: 'UTC',
      global_concurrency: 1,
      local_concurrency: 1,
      no_compose_run: true,
    },
    log_signal: {
      classifier_mode: CLASSIFIER_MODE,
      classifier_version: CLASSIFIER_VERSION,
      source_owner: [
        'src/bootstrap/bootstrap-error.ts',
        'src/tenant-auth/jwks-cache.service.ts',
        'src/maintenance/cleanup.telemetry.ts',
        'Nest default logger severity token',
      ],
      supported_docker_log_driver_classes: ['DOCKER_JSON_FILE', 'DOCKER_LOCAL'],
      fail_closed_results: [
        'NO_ERROR_LEVEL_SIGNALS',
        'ERROR_LEVEL_SIGNAL_PRESENT',
        'FATAL_LEVEL_SIGNAL_PRESENT',
        'LOG_SIGNAL_COLLECTION_FAILED',
        'LOG_SIGNAL_UNSUPPORTED_DRIVER',
        'LOG_SIGNAL_CLASSIFIER_MISMATCH',
      ],
      accepted_error_total: 0,
      accepted_fatal_total: 0,
      warning_total_recorded_only: true,
      raw_logs_retained: false,
    },
    returned_inventory: [...EVIDENCE_FILES],
    parent_receipt_hashes: { ...PARENT_RECEIPT_HASHES },
    forbidden_operations: [
      'git fetch/pull/switch/checkout/reset/clean/restore/stash/add/commit',
      'docker build/pull/push/load',
      'docker compose up/down/restart/stop/rm/run/create',
      'docker logs persisted to file',
      'full docker inspect JSON',
      'container env inspection',
      'journalctl',
      'env/printenv or env file dump',
      'database or Redis command',
      'authenticated HTTP',
      'edge body-limit probe',
      'TLS bypass',
      'curl retry',
      'package install',
      'service/timer/cron creation',
    ],
    safety_flags: {
      evidence_collected_by_handoff_generation: false,
      production_contact_performed_by_handoff_generation: false,
      production_mutation_performed: false,
      deployment_performed: false,
      restart_performed: false,
      migration_performed: false,
      backup_performed: false,
      restore_performed: false,
      auth_credentials_used: false,
      raw_log_retained: false,
      raw_health_retained: false,
      artifact_publication: false,
      git_tag: false,
      github_release: false,
    },
  };
}

function handoffManifest({ sourceCommit, observerSha, contractSha, generatedAt }) {
  return {
    schema_version: 1,
    bundle_type: 'production-operational-smoke-handoff',
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    final_landed_source_commit: sourceCommit,
    canonical_remote: CANONICAL_REMOTE,
    generated_by: 'scripts/production-operational-smoke-evidence.mjs',
    generated_at_utc: generatedAt,
    observer: {
      filename: HANDOFF_OBSERVER,
      sha256: observerSha,
      executable_intended: true,
    },
    contract: {
      filename: HANDOFF_CONTRACT,
      version: CONTRACT_VERSION,
      sha256: contractSha,
    },
    window_class: WINDOW_CLASS,
    window_seconds: WINDOW_SECONDS,
    window_minutes: WINDOW_MINUTES,
    primary_interval_seconds: PRIMARY_INTERVAL_SECONDS,
    primary_sample_count: PRIMARY_SAMPLE_COUNT,
    worker_interval_seconds: WORKER_INTERVAL_SECONDS,
    worker_sample_count: WORKER_SAMPLE_COUNT,
    error_bucket_seconds: ERROR_BUCKET_SECONDS,
    error_bucket_count: ERROR_BUCKET_COUNT,
    max_sample_lag_seconds: MAX_SAMPLE_LAG_SECONDS,
    long_term_stability_claim: false,
    long_term_stability_status: LONG_TERM_STABILITY_STATUS,
    historical_v1_supersession_class: HISTORICAL_V1_SUPERSESSION_CLASS,
    health_routes: [
      'GET http://127.0.0.1:3200/health/live',
      'GET http://127.0.0.1:3200/health/ready',
      'GET https://rss.habersoft.com/health/live',
      'GET https://rss.habersoft.com/health/ready',
    ],
    expected_services: ['main-service-api', 'main-service-worker'],
    log_classifier: {
      mode: CLASSIFIER_MODE,
      version: CLASSIFIER_VERSION,
      supported_docker_log_driver_classes: ['DOCKER_JSON_FILE', 'DOCKER_LOCAL'],
    },
    final_output_inventory: [...EVIDENCE_FILES],
    parent_receipt_hashes: { ...PARENT_RECEIPT_HASHES },
    safety_flags: {
      evidence_collected: false,
      production_contact_performed: false,
      production_mutation_performed: false,
      deployment_performed: false,
      restart_performed: false,
      migration_performed: false,
      backup_performed: false,
      restore_performed: false,
      auth_credential_used: false,
      raw_log_retained: false,
      raw_health_retained: false,
      artifact_publication: false,
      git_tag: false,
      github_release: false,
      secrets_included: false,
    },
    evidence_collected: false,
    production_contact_performed: false,
    production_mutation_performed: false,
    deployment_performed: false,
    restart_performed: false,
    migration_performed: false,
    backup_performed: false,
    restore_performed: false,
    auth_credential_used: false,
    raw_log_retained: false,
    raw_health_retained: false,
    artifact_publication: false,
    git_tag: false,
    github_release: false,
    secrets_included: false,
  };
}

function validateHandoffContract(contract) {
  assert(contract.contract_version === CONTRACT_VERSION, 'contract version mismatch');
  assert(contract.milestone === MILESTONE, 'contract milestone mismatch');
  assert(contract.service === SERVICE_NAME, 'contract service mismatch');
  assert(contract.environment === 'production', 'contract environment mismatch');
  assert(contract.canonical_remote === CANONICAL_REMOTE, 'contract remote mismatch');
  assert(contract.observation.evidence_class === WINDOW_CLASS, 'contract evidence class mismatch');
  assert(contract.observation.window_seconds === WINDOW_SECONDS, 'contract window mismatch');
  assert(contract.observation.window_minutes === WINDOW_MINUTES, 'contract window minutes mismatch');
  assert(contract.observation.confirm_window_minutes === WINDOW_MINUTES, 'contract confirm window mismatch');
  assert(contract.observation.primary_sample_count === PRIMARY_SAMPLE_COUNT, 'contract primary count mismatch');
  assert(contract.observation.worker_sample_count === WORKER_SAMPLE_COUNT, 'contract worker count mismatch');
  assert(contract.observation.error_bucket_seconds === ERROR_BUCKET_SECONDS, 'contract error bucket seconds mismatch');
  assert(contract.observation.error_bucket_count === ERROR_BUCKET_COUNT, 'contract bucket count mismatch');
  assert(contract.observation.max_sample_lag_seconds === MAX_SAMPLE_LAG_SECONDS, 'contract lag limit mismatch');
  assert(contract.observation.retry === false, 'contract retry must be false');
  assert(contract.observation.concurrency === 1, 'contract concurrency must be 1');
  assert(contract.governance_boundary.long_term_stability_claim === false, 'contract long-term claim must be false');
  assert(contract.governance_boundary.long_term_stability_status === LONG_TERM_STABILITY_STATUS, 'contract long-term status mismatch');
  assert(contract.governance_boundary.historical_v1_supersession_class === HISTORICAL_V1_SUPERSESSION_CLASS, 'contract v1 supersession mismatch');
  assert(contract.log_signal.classifier_mode === CLASSIFIER_MODE, 'contract classifier mismatch');
  assert(contract.log_signal.accepted_error_total === 0, 'contract error threshold mismatch');
  assert(contract.log_signal.accepted_fatal_total === 0, 'contract fatal threshold mismatch');
  assertSameArray(contract.returned_inventory, [...EVIDENCE_FILES], 'contract returned inventory mismatch');
  for (const [key, value] of Object.entries(contract.safety_flags)) {
    assert(value === false, `contract safety flag ${key} must be false`);
  }
}

function validateHandoffManifest(manifest, checksumMap, contract) {
  assert(manifest.contract_version === CONTRACT_VERSION, 'manifest contract version mismatch');
  assert(manifest.bundle_type === 'production-operational-smoke-handoff', 'manifest bundle type mismatch');
  assert(manifest.milestone === MILESTONE, 'manifest milestone mismatch');
  assert(manifest.service === SERVICE_NAME, 'manifest service mismatch');
  assert(manifest.environment === 'production', 'manifest environment mismatch');
  assert(manifest.canonical_remote === CANONICAL_REMOTE, 'manifest remote mismatch');
  assert(isGitSha(manifest.final_landed_source_commit), 'manifest source commit malformed');
  assert(manifest.observer.filename === HANDOFF_OBSERVER, 'manifest observer filename mismatch');
  assert(manifest.observer.sha256 === checksumMap[HANDOFF_OBSERVER], 'manifest observer checksum mismatch');
  assert(manifest.contract.filename === HANDOFF_CONTRACT, 'manifest contract filename mismatch');
  assert(manifest.contract.version === CONTRACT_VERSION, 'manifest contract version mismatch');
  assert(manifest.contract.sha256 === checksumMap[HANDOFF_CONTRACT], 'manifest contract checksum mismatch');
  assert(manifest.window_class === WINDOW_CLASS, 'manifest window class mismatch');
  assert(manifest.window_seconds === contract.observation.window_seconds, 'manifest window mismatch');
  assert(manifest.window_minutes === WINDOW_MINUTES, 'manifest window minutes mismatch');
  assert(manifest.primary_sample_count === PRIMARY_SAMPLE_COUNT, 'manifest primary count mismatch');
  assert(manifest.worker_sample_count === WORKER_SAMPLE_COUNT, 'manifest worker count mismatch');
  assert(manifest.error_bucket_seconds === ERROR_BUCKET_SECONDS, 'manifest error bucket seconds mismatch');
  assert(manifest.error_bucket_count === ERROR_BUCKET_COUNT, 'manifest bucket count mismatch');
  assert(manifest.max_sample_lag_seconds === MAX_SAMPLE_LAG_SECONDS, 'manifest lag limit mismatch');
  assert(manifest.long_term_stability_claim === false, 'manifest long-term claim must be false');
  assert(manifest.long_term_stability_status === LONG_TERM_STABILITY_STATUS, 'manifest long-term status mismatch');
  assert(manifest.historical_v1_supersession_class === HISTORICAL_V1_SUPERSESSION_CLASS, 'manifest v1 supersession mismatch');
  assert(manifest.log_classifier.mode === CLASSIFIER_MODE, 'manifest classifier mode mismatch');
  assertSameArray(manifest.final_output_inventory, [...EVIDENCE_FILES], 'manifest output inventory mismatch');
  assertSameObject(manifest.parent_receipt_hashes, PARENT_RECEIPT_HASHES, 'manifest parent hashes mismatch');
  for (const [key, value] of Object.entries(manifest.safety_flags)) {
    assert(value === false, `manifest safety flag ${key} must be false`);
    assert(manifest[key] === false, `manifest top-level flag ${key} must be false`);
  }
}

function staticScanObserver(content) {
  const forbidden = [
    { label: 'git mutation', pattern: /(^|[;&|()])\s*git\s+(?:-[^\s]+\s+)*(?:fetch|pull|switch|checkout|reset|clean|restore|stash|add|commit)\b/m },
    { label: 'docker image mutation', pattern: /(^|[;&|()])\s*docker\s+(?:build|pull|push|load|system\s+prune|image\s+prune)\b/m },
    { label: 'docker compose mutation', pattern: /(^|[;&|()])\s*docker\s+compose\b[^\n\r]*(?:\s|^)(?:up|down|restart|stop|rm|run|create)\b/m },
    { label: 'docker logs persistence', pattern: /docker\s+logs[^\n\r]*(?:>>|\btee\b|>\s*(?!&1\b)(?!["']?\$counts_file\b)[^|\n\r]*\.(?:log|txt|json|out)\b)/m },
    { label: 'full docker inspect JSON', pattern: /docker\s+inspect(?![^\n\r]*--format)/m },
    { label: 'journalctl', pattern: /(^|[;&|()])\s*journalctl\b/m },
    { label: 'env dump', pattern: /(^|[;&|()])\s*(?:env|printenv)(?:\s|$)/m },
    { label: 'env file dump', pattern: /(^|[;&|()])\s*(?:cat|grep|sed)\b[^\n\r]*(?:\.env|runtime-image\.env)/m },
    { label: 'database or Redis command', pattern: /(^|[;&|()])\s*(?:psql|redis-cli)\b/m },
    { label: 'package install', pattern: /\b(?:npm|pnpm|yarn|apt|apt-get|apk|yum|dnf)\s+(?:install|add)\b/ },
    { label: 'sudo', pattern: /(^|[;&|()])\s*sudo\b/m },
    { label: 'service timer cron', pattern: /\b(?:systemctl|crontab)\b/ },
    { label: 'shell tracing', pattern: /set\s+-x/ },
    { label: 'curl retry', pattern: /\bcurl\b[^\n\r]*(?:--retry\b|--insecure\b|-k\b)/m },
  ];
  for (const item of forbidden) {
    if (item.pattern.test(content)) {
      fail(`observer contains forbidden operation: ${item.label}`);
    }
  }
  assert(content.includes('docker logs --since "$start_utc" --until "$end_utc" "$cid" 2>&1 | classify_log_stream'), 'observer must pipe docker logs directly to classifier');
  assert(!content.includes('bash -x'), 'observer must not mention bash -x execution');
}

function parseMetadata(text) {
  const result = {};
  for (const [lineNumber, line] of text.split(/\n/u).entries()) {
    if (line === '') continue;
    const index = line.indexOf('=');
    if (index <= 0) fail(`invalid metadata line ${lineNumber + 1}`);
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    if (!/^[a-z0-9_]+$/u.test(key)) fail(`invalid metadata key ${key}`);
    if (Object.hasOwn(result, key)) fail(`duplicate metadata key ${key}`);
    result[key] = value;
  }
  return result;
}

function parseTsv(text) {
  const lines = text.split(/\n/u).filter(Boolean);
  assert(lines.length >= 1, 'TSV must have a header');
  const header = lines[0].split('\t');
  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) fail(`TSV row ${rowIndex + 2} cell count mismatch`);
    return Object.fromEntries(header.map((key, index) => [key, cells[index]]));
  });
}

function parseChecksumFile(content) {
  const map = {};
  for (const line of content.split(/\n/u).filter(Boolean)) {
    const match = line.match(/^([A-Fa-f0-9]{64})  ([A-Za-z0-9._/-]+)$/u);
    if (!match) fail(`invalid checksum line: ${line}`);
    const [, hash, name] = match;
    if (Object.hasOwn(map, name)) fail(`duplicate checksum entry ${name}`);
    map[name] = hash.toLowerCase();
  }
  return map;
}

function verifyChecksums(dir, expectedNames) {
  const checksums = parseChecksumFile(readAndValidateTextFile(dir, 'checksums.sha256'));
  assertSameArray(Object.keys(checksums).sort(), [...expectedNames].sort(), 'checksum inventory mismatch');
  for (const [name, expected] of Object.entries(checksums)) {
    const actual = sha256File(path.join(dir, name));
    if (actual !== expected) fail(`checksum mismatch for ${name}`);
  }
  return checksums;
}

function writeChecksums(dir, names) {
  const text = `${names.map((name) => `${sha256File(path.join(dir, name))}  ${name}`).join('\n')}\n`;
  writeText(path.join(dir, 'checksums.sha256'), text, 0o600);
}

function safeFileInventory(dir, expectedNames) {
  return expectedNames.map((name) => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) fail(`symlink not allowed: ${name}`);
    if (!stat.isFile()) fail(`expected regular file: ${name}`);
    return {
      relative_path: name,
      file_type: 'regular',
      byte_size: stat.size,
      sha256: sha256File(file),
    };
  });
}

function treeDigest(inventory) {
  return sha256Text(stableJson(inventory.map(({ relative_path, byte_size, sha256 }) => ({
    relative_path,
    byte_size,
    sha256,
  }))));
}

function readAndValidateTextFile(dir, name) {
  const file = path.join(dir, name);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) fail(`symlink not allowed: ${name}`);
  if (!stat.isFile()) fail(`expected regular file: ${name}`);
  const text = readText(file);
  assertLfOnly(name, text);
  scanForForbiddenContent(name, text);
  return text;
}

function scanForForbiddenContent(name, text) {
  const forbidden = [
    /\bDATABASE_URL\s*=/iu,
    /\bPOSTGRES_PASSWORD\s*=/iu,
    /\bAGENT_KEY\s*=/iu,
    /\bTENANT_RATE_LIMIT_KEY_SECRET\s*=/iu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /"Env"\s*:/u,
    /\bdiff --git\b/u,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) fail(`${name} contains forbidden private/secret-looking content`);
  }
}

function assertExactInventory(dir, expected) {
  const actual = fs.readdirSync(dir).sort();
  assertSameArray(actual, [...expected].sort(), `inventory mismatch in ${dir}`);
}

function assertBashSyntax(file) {
  const bash = process.platform === 'win32' ? 'bash.exe' : 'bash';
  const candidates = process.platform === 'win32' ? bashPathCandidates(file) : [file];
  const results = candidates.map((candidate) => spawnSync(bash, ['-n', candidate], { encoding: 'utf8' }));
  const ok = results.find((result) => result.status === 0 && !result.error);
  if (ok === undefined) {
    const last = results.at(-1);
    fail(`bash syntax failed for ${file}: ${last?.stderr || last?.error?.message || 'unknown error'}`);
  }
}

function bashPathCandidates(file) {
  const normalized = file.replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  return match ? [`/mnt/${match[1].toLowerCase()}/${match[2]}`, `/${match[1].toLowerCase()}/${match[2]}`, normalized] : [normalized];
}

function bashPathArg(file) {
  if (process.platform !== 'win32') {
    return file;
  }
  const bash = 'bash.exe';
  for (const candidate of bashPathCandidates(file)) {
    const root = bashCandidateRoot(candidate);
    if (root === '') {
      continue;
    }
    const result = spawnSync(bash, ['-lc', 'test -e "$1"', 'codex-path-probe', root], { encoding: 'utf8' });
    if (result.status === 0 && !result.error) {
      return candidate;
    }
  }
  return bashPathCandidates(file)[0];
}

function bashCandidateRoot(candidate) {
  const mountedDrive = candidate.match(/^(\/mnt\/[a-z])(?:\/|$)/u);
  if (mountedDrive) {
    return mountedDrive[1];
  }
  const slashDrive = candidate.match(/^(\/[a-z])(?:\/|$)/u);
  if (slashDrive) {
    return slashDrive[1];
  }
  return '';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  return String(result.stdout ?? '').trim();
}

function currentGitCommit() {
  return run('git', ['rev-parse', 'HEAD']);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function ensureEmptyOutputDir(dir) {
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) fail(`output path exists and is not a directory: ${dir}`);
    if (fs.readdirSync(dir).length > 0) fail(`output directory must be empty: ${dir}`);
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function assertNoOverwrite(file) {
  if (fs.existsSync(file)) fail(`refusing to overwrite existing file: ${file}`);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, text, mode = 0o600) {
  fs.writeFileSync(file, text, { encoding: 'utf8', mode });
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertLfOnly(name, text) {
  if (text.includes('\r')) fail(`${name} contains CR bytes`);
}

function numberField(value, label) {
  assert(/^(?:0|[1-9][0-9]*)$/u.test(String(value)), `${label} must be a non-negative integer`);
  return Number(value);
}

function boolField(value, label) {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  fail(`${label} must be boolean`);
}

function utcElapsedSeconds(startedAtUtc, endedAtUtc, label) {
  const started = parseUtcSecond(startedAtUtc, `${label} start`);
  const ended = parseUtcSecond(endedAtUtc, `${label} end`);
  assert(ended >= started, `${label} end precedes start`);
  return ended - started;
}

function parseUtcSecond(value, label) {
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(String(value)), `${label} must be UTC second timestamp`);
  const milliseconds = Date.parse(value);
  assert(Number.isFinite(milliseconds), `${label} timestamp malformed`);
  assert(milliseconds % 1000 === 0, `${label} must not include sub-second precision`);
  return milliseconds / 1000;
}

function isGitSha(value) {
  return /^[a-f0-9]{40}$/u.test(String(value));
}

function assertSameArray(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
}

function sameStringArray(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function assertSameObject(actual, expected, label) {
  if (stableJson(actual) !== stableJson(expected)) fail(label);
}

function assertExactObjectKeys(actual, expectedKeys, label) {
  assert(actual !== null && typeof actual === 'object' && !Array.isArray(actual), `${label}: expected object`);
  const actualKeys = Object.keys(actual).sort();
  const expected = [...expectedKeys].sort();
  assertSameArray(actualKeys, expected, label);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  throw new Error(message);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
