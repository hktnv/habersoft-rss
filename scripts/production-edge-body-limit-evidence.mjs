#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASE_IDENTITY } from './release-identity.mjs';

const CONTRACT_VERSION = 'production-edge-body-limit-evidence-v1';
const RECEIPT_SCHEMA_VERSION = 'production-edge-body-limit-receipt-v1';
const AUTHORITY_SCHEMA_VERSION = 'production-edge-body-limit-returned-authority-v1';
const FREEZE_SCHEMA_VERSION = 'production-edge-body-limit-handoff-freeze-v1';
const CORRECTED_RECEIPT_REVISION = 'production-edge-body-limit-receipt-v2';
const SEMANTIC_CORRECTION_CLASS = 'VERIFIER_BUG_EARLY_REJECTION_SEMANTICS';
const HISTORICAL_BLOCKED_RECEIPT_SHA256 = '9bd74b14d50525d1f408deebbb19d8912e71b4d21fe7f23b41a602ba0f966965';
const MILESTONE = 'MS-019E';
const RECEIPT_MILESTONE = 'MS-019E-R1';
const SERVICE_NAME = 'main-service';
const CANONICAL_REMOTE = 'https://github.com/hktnv/habersoft-rss';
const ROUTE = '/agent/entries';
const METHOD = 'POST';
const CONTENT_TYPE = 'application/json';
const INTERNAL_BASE = 'http://127.0.0.1:3200';
const PUBLIC_BASE = 'https://rss.habersoft.com';
const CONFIRM_PUBLIC_HOST = 'rss.habersoft.com';
const BODY_LIMIT_BYTES = 5 * 1024 * 1024;
const SMALL_BODY_BYTES = 1024;
const EXACT_BODY_BYTES = BODY_LIMIT_BYTES;
const OVER_BODY_BYTES = BODY_LIMIT_BYTES + 1;
const MAX_REQUEST_COUNT = 6;

const PARENT_RECEIPT_HASHES = Object.freeze({
  ms_018c_basic_acceptance_receipt: '62b0e21bf76f21a5db04698f3d593bf1592d370eef06f50169ab63b2cc3b8163',
  ms_019b_operational_receipt: '3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620',
  ms_019c_production_backup: '1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8',
  ms_019c_combined_backup_restore_receipt: '868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735',
  ms_019d_checkout_pointer_receipt: 'e823ec819d471c8bb3c5052e6def3a6830731058952971675bdd4ae4d1f6c63a',
});

const PROBES = Object.freeze([
  ['CONTROL_SMALL', 'INTERNAL_LOOPBACK', SMALL_BODY_BYTES, 401],
  ['CONTROL_SMALL', 'PUBLIC_HTTPS', SMALL_BODY_BYTES, 401],
  ['EXACT_LIMIT', 'INTERNAL_LOOPBACK', EXACT_BODY_BYTES, 401],
  ['EXACT_LIMIT', 'PUBLIC_HTTPS', EXACT_BODY_BYTES, 401],
  ['LIMIT_PLUS_ONE', 'INTERNAL_LOOPBACK', OVER_BODY_BYTES, 413],
  ['LIMIT_PLUS_ONE', 'PUBLIC_HTTPS', OVER_BODY_BYTES, 413],
]);

const HANDOFF_COLLECTOR = 'collect-production-edge-body-limit-evidence.sh';
const HANDOFF_CONTRACT = 'edge-body-limit-contract.json';
const HANDOFF_FILES = Object.freeze([
  'README.md',
  HANDOFF_COLLECTOR,
  HANDOFF_CONTRACT,
  'manifest.json',
  'checksums.sha256',
]);
const HANDOFF_CHECKSUM_FILES = Object.freeze([
  'README.md',
  HANDOFF_COLLECTOR,
  HANDOFF_CONTRACT,
  'manifest.json',
]);
const EVIDENCE_FILES = Object.freeze(['checksums.sha256', 'collector-metadata.txt', 'evidence-records.tsv']);

const EXPECTED_METADATA_KEYS = new Set([
  'collector',
  'milestone',
  'service',
  'contract_version',
  'canonical_remote',
  'source_commit',
  'collector_sha256',
  'collection_utc',
  'route',
  'method',
  'content_type',
  'body_limit_bytes',
  'small_body_bytes',
  'exact_body_bytes',
  'over_body_bytes',
  'max_request_count',
  'actual_request_count',
  'canonical_public_host',
  'internal_base_class',
  'public_base_class',
  'auth_credential_used',
  'cookies',
  'retries',
  'concurrency',
  'payload_retained',
  'response_retained',
  'headers_retained',
  'mutation',
  'safe_stop_reason',
]);

const EXPECTED_RECORD_KEYS = new Set([
  'probe_class',
  'target_class',
  'method',
  'route',
  'content_type',
  'requested_bytes',
  'generated_bytes',
  'uploaded_bytes',
  'upload_bytes_match',
  'curl_exit_code',
  'curl_exit_class',
  'http_status',
  'expected_http_status',
  'http_status_match',
  'tls_verification',
  'ssl_verify_result',
  'http_version',
  'auth_credential_used',
  'cookies_used',
  'retry_used',
  'mutation',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.dirname(REPO_ROOT);
const SOURCE_COLLECTOR = path.join(REPO_ROOT, 'scripts', 'production-edge-body-limit-collector.sh');
const DEFAULT_HANDOFF_DIR = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019e',
  'production-edge-body-limit-handoff-v1',
);
const DEFAULT_FREEZE_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019e',
  'verification',
  'handoff-v1-freeze.json',
);
const DEFAULT_AUTHORITY_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019e',
  'verification',
  'production-edge-body-limit-returned-v1-authority.json',
);
const DEFAULT_HISTORICAL_BLOCKED_RECEIPT_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019e',
  'production-edge-body-limit-receipt.json',
);
const DEFAULT_RECEIPT_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019e',
  'production-edge-body-limit-receipt-v2.json',
);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}${os.EOL}`);
    process.exitCode = 1;
  });
}

export function expectedPayload(size) {
  const prefix = '{"probe":"';
  const suffix = '"}';
  const fill = size - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (fill < 0) {
    throw new Error('payload size is too small');
  }
  return `${prefix}${'a'.repeat(fill)}${suffix}`;
}

export function verifyApplicationContract() {
  const policy = readText(path.join(REPO_ROOT, 'src', 'agent-entries', 'agent-entries.policy.ts'));
  const bootstrap = readText(path.join(REPO_ROOT, 'src', 'bootstrap', 'api-entrypoint.ts'));
  const controller = readText(path.join(REPO_ROOT, 'src', 'agent-entries', 'agent-entries.controller.ts'));
  const controllerTest = readText(path.join(REPO_ROOT, 'test', 'agent-entries', 'agent-entries.controller.spec.ts'));
  const bootstrapTest = readText(path.join(REPO_ROOT, 'test', 'bootstrap', 'bootstrap.spec.ts'));
  const agentEntryDoc = readText(path.join(REPO_ROOT, '.docs', 'agent-entry-ingestion.md'));
  const agentAuthDoc = readText(path.join(REPO_ROOT, '.docs', 'agent-authentication.md'));

  assert(
    /AGENT_ENTRIES_BODY_LIMIT_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/u.test(policy),
    'AGENT_ENTRIES_BODY_LIMIT_BYTES must remain 5 * 1024 * 1024',
  );
  assert(
    /new FastifyAdapter\(\{\s*bodyLimit:\s*AGENT_ENTRIES_BODY_LIMIT_BYTES\s*\}\)/su.test(bootstrap),
    'FastifyAdapter bodyLimit must use AGENT_ENTRIES_BODY_LIMIT_BYTES',
  );
  assert(
    bootstrap.includes('path === "/agent/entries"') &&
      bootstrap.includes('contentLength > limit') &&
      bootstrap.includes('reply.code(413).send({ error_code: "REQUEST_BODY_TOO_LARGE" })'),
    'bootstrap body limit hook must protect POST /agent/entries and reject limit+1 with 413',
  );
  assert(controller.includes('@Controller("agent/entries")'), 'Agent entries controller route mismatch');
  assert(controller.includes('@UseGuards(AgentKeyAuthGuard)'), 'Agent entries route must be guarded');
  assert(
    controller.includes('validateAgentEntriesRequest(body, query)') &&
      controller.indexOf('validateAgentEntriesRequest(body, query)') < controller.indexOf('recordEntries.execute'),
    'Agent entries controller must validate before use-case execution after auth guard passes',
  );
  assert(
    bootstrapTest.includes('AGENT_ENTRIES_BODY_LIMIT_BYTES + 1') &&
      bootstrapTest.includes('AGENT_ENTRIES_BODY_LIMIT_BYTES)') &&
      bootstrapTest.includes('toHaveBeenCalledWith(413)') &&
      bootstrapTest.includes('entriesAllowed.done'),
    'bootstrap tests must cover exact limit and limit+1 behavior',
  );
  assert(
    controllerTest.includes('runs auth before payload validation') &&
      controllerTest.includes('statusCode).toBe(401)') &&
      controllerTest.includes('execute).not.toHaveBeenCalled()'),
    'controller tests must prove missing auth blocks business handler',
  );
  assert(
    agentEntryDoc.includes('POST /agent/entries') &&
      agentEntryDoc.includes('wrong Agent key returns `401` before payload validation') &&
      agentEntryDoc.includes('Body over the route limit returns `413`'),
    'agent entry docs must describe route, auth precedence, and 413 boundary',
  );
  assert(
    agentAuthDoc.includes('Public header: `X-Agent-Key`') &&
      agentAuthDoc.includes('Tenant JWT authentication ayri kalir') &&
      agentAuthDoc.includes('Missing, malformed, duplicate veya wrong key tek tip safe `401`'),
    'agent auth docs must keep Agent key boundary explicit',
  );

  return {
    route: ROUTE,
    method: METHOD,
    content_type: CONTENT_TYPE,
    body_limit_bytes: BODY_LIMIT_BYTES,
    byte_unit: 'binary_mib',
    exact_limit_expected_status_without_auth: 401,
    limit_plus_one_expected_status: 413,
    auth_blocks_business_handler: true,
    runtime_source_changed: false,
  };
}

function parseArgs(rawArgs) {
  const options = {
    handoffDir: DEFAULT_HANDOFF_DIR,
    freezeFile: DEFAULT_FREEZE_FILE,
    authorityFile: DEFAULT_AUTHORITY_FILE,
    receiptFile: DEFAULT_RECEIPT_FILE,
    evidenceDir: '',
    fixtureResult: 'NOT_RUN',
    requireCompatibility: false,
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
      case '--bundle':
        options.handoffDir = path.resolve(next());
        break;
      case '--freeze-file':
        options.freezeFile = path.resolve(next());
        break;
      case '--authority-file':
      case '--authority':
        options.authorityFile = path.resolve(next());
        break;
      case '--evidence-dir':
      case '--evidence':
        options.evidenceDir = path.resolve(next());
        break;
      case '--output-file':
      case '--receipt-file':
      case '--receipt':
        options.receiptFile = path.resolve(next());
        break;
      case '--fixture-result':
      case '--fixture-smoke-result':
        options.fixtureResult = next();
        break;
      case '--require-edge-body-limit-compatibility':
        options.requireCompatibility = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }
  return { positional, options };
}

function generateHandoff(options) {
  verifyApplicationContract();
  prepareEmptyExternalDir(options.handoffDir);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const generatedAt = new Date().toISOString();
  const collector = readText(SOURCE_COLLECTOR).replaceAll('__MS019E_SOURCE_COMMIT__', sourceCommit);

  writeText(path.join(options.handoffDir, HANDOFF_COLLECTOR), collector, 0o755);
  writeText(path.join(options.handoffDir, 'README.md'), renderReadme(sourceCommit, generatedAt), 0o644);
  writeJson(path.join(options.handoffDir, HANDOFF_CONTRACT), createContract(sourceCommit), 0o644);
  const manifest = createManifest(options.handoffDir, sourceCommit, generatedAt);
  writeJson(path.join(options.handoffDir, 'manifest.json'), manifest, 0o644);
  writeChecksums(options.handoffDir, HANDOFF_CHECKSUM_FILES);
  const verified = verifyHandoff(options);
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-handoff-generated',
        bundle: options.handoffDir,
        source_commit: sourceCommit,
        manifest_sha256: sha256File(path.join(options.handoffDir, 'manifest.json')),
        collector_sha256: verified.collector_sha256,
        evidence_collected: false,
        production_contact: false,
        production_mutation: false,
      },
      null,
      2,
    ),
  );
}

function verifyHandoff(options) {
  const dir = options.handoffDir;
  assert(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `handoff directory does not exist: ${dir}`);
  assertExactInventory(dir, HANDOFF_FILES);
  const checksums = verifyChecksums(dir, HANDOFF_CHECKSUM_FILES);
  const readme = readAndValidateText(path.join(dir, 'README.md'), 'README.md');
  const collector = readAndValidateText(path.join(dir, HANDOFF_COLLECTOR), HANDOFF_COLLECTOR);
  const contract = readJsonValidated(path.join(dir, HANDOFF_CONTRACT), HANDOFF_CONTRACT);
  const manifest = readJsonValidated(path.join(dir, 'manifest.json'), 'manifest.json');

  validateContract(contract);
  validateManifest(manifest, checksums);
  scanTextForSecrets(readme, 'README.md');
  scanTextForSecrets(collector, HANDOFF_COLLECTOR);
  staticScanCollector(collector);
  assertBashSyntax(path.join(dir, HANDOFF_COLLECTOR));
  assert(checksums.get(HANDOFF_COLLECTOR) === manifest.collector.sha256, 'manifest collector hash mismatch');
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-handoff-verified',
        bundle: dir,
        files: HANDOFF_FILES,
        manifest_sha256: sha256File(path.join(dir, 'manifest.json')),
        collector_sha256: checksums.get(HANDOFF_COLLECTOR),
        production_contact: false,
        production_mutation: false,
      },
      null,
      2,
    ),
  );
  return { manifest, contract, collector_sha256: checksums.get(HANDOFF_COLLECTOR) };
}

function freezeHandoff(options) {
  assertNoOverwrite(options.freezeFile);
  const verified = verifyHandoff(options);
  ensureDir(path.dirname(options.freezeFile));
  const inventory = HANDOFF_FILES.map((file) => {
    const absolute = path.join(options.handoffDir, file);
    return {
      relative_path: file,
      bytes: fs.statSync(absolute).size,
      sha256: sha256File(absolute),
    };
  });
  const freeze = {
    schema_version: FREEZE_SCHEMA_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    created_at_utc: new Date().toISOString(),
    inventory,
    manifest_sha256: sha256File(path.join(options.handoffDir, 'manifest.json')),
    collector_sha256: verified.collector_sha256,
    contract_sha256: sha256File(path.join(options.handoffDir, HANDOFF_CONTRACT)),
    contract_version: CONTRACT_VERSION,
    final_landed_source_commit: verified.manifest.source_commit,
    body_limit_bytes: BODY_LIMIT_BYTES,
    probe_sizes: {
      small: SMALL_BODY_BYTES,
      exact_limit: EXACT_BODY_BYTES,
      limit_plus_one: OVER_BODY_BYTES,
    },
    lf_only: true,
    bash_syntax: 'PASSED',
    safety_scan: 'PASSED',
    generated_handoff_fixture_result: options.fixtureResult,
    production_contact: false,
    production_mutation: false,
    evidence_collected: false,
    secrets: false,
  };
  writeJson(options.freezeFile, freeze, 0o600);
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-handoff-frozen',
        freeze_file: options.freezeFile,
        freeze_sha256: sha256File(options.freezeFile),
        manifest_sha256: freeze.manifest_sha256,
        collector_sha256: freeze.collector_sha256,
        fixture_result: options.fixtureResult,
      },
      null,
      2,
    ),
  );
}

function verifyFreeze(options) {
  const verified = verifyHandoff(options);
  const freeze = readJsonValidated(options.freezeFile, path.basename(options.freezeFile));
  const inventory = HANDOFF_FILES.map((file) => {
    const absolute = path.join(options.handoffDir, file);
    return {
      relative_path: file,
      bytes: fs.statSync(absolute).size,
      sha256: sha256File(absolute),
    };
  });
  assert(freeze.schema_version === FREEZE_SCHEMA_VERSION, 'freeze schema version mismatch');
  assert(freeze.milestone === MILESTONE && freeze.service === SERVICE_NAME, 'freeze identity mismatch');
  assert(JSON.stringify(freeze.inventory) === JSON.stringify(inventory), 'freeze inventory mismatch');
  assert(freeze.manifest_sha256 === sha256File(path.join(options.handoffDir, 'manifest.json')), 'freeze manifest hash mismatch');
  assert(freeze.collector_sha256 === verified.collector_sha256, 'freeze collector hash mismatch');
  assert(freeze.contract_sha256 === sha256File(path.join(options.handoffDir, HANDOFF_CONTRACT)), 'freeze contract hash mismatch');
  assert(freeze.contract_version === CONTRACT_VERSION, 'freeze contract version mismatch');
  assert(freeze.final_landed_source_commit === verified.manifest.source_commit, 'freeze source commit mismatch');
  assert(freeze.body_limit_bytes === BODY_LIMIT_BYTES, 'freeze body limit mismatch');
  assert(freeze.generated_handoff_fixture_result === 'PASSED', 'freeze fixture result must be PASSED');
  for (const flag of ['production_contact', 'production_mutation', 'evidence_collected', 'secrets']) {
    assert(freeze[flag] === false, `freeze flag must be false: ${flag}`);
  }
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-handoff-freeze-verified',
        freeze_file: options.freezeFile,
        freeze_sha256: sha256File(options.freezeFile),
        manifest_sha256: freeze.manifest_sha256,
        collector_sha256: freeze.collector_sha256,
        fixture_result: freeze.generated_handoff_fixture_result,
      },
      null,
      2,
    ),
  );
  return { freeze, verified };
}

function createAuthority(options) {
  assert(options.evidenceDir, '--evidence-dir is required');
  const { freeze, verified } = verifyFreeze(options);
  const inventory = returnedSafeInventory(options.evidenceDir);
  const authority = {
    schema_version: AUTHORITY_SCHEMA_VERSION,
    record_type: 'PRODUCTION_EDGE_BODY_LIMIT_RETURNED_AUTHORITY',
    milestone: RECEIPT_MILESTONE,
    handoff_milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    submission_kind: 'LANDED_HANDOFF_V1_EDGE_BODY_PROBE',
    authority_source: 'HUMAN_OPERATOR_EXPLICIT_SUBMISSION',
    selected_input_alias: 'production-edge-body-limit-returned-v1',
    created_at_utc: new Date().toISOString(),
    authorization_effective_at_utc: new Date().toISOString(),
    authoritative_tree_digest: returnedTreeDigest(inventory),
    authoritative_safe_file_count: inventory.length,
    safe_inventory: inventory,
    expected_handoff_source_commit: verified.manifest.source_commit,
    expected_handoff_manifest_sha256: sha256File(path.join(options.handoffDir, 'manifest.json')),
    expected_handoff_collector_sha256: verified.collector_sha256,
    expected_handoff_contract_sha256: sha256File(path.join(options.handoffDir, HANDOFF_CONTRACT)),
    expected_handoff_freeze_sha256: sha256File(options.freezeFile),
    expected_contract_version: CONTRACT_VERSION,
    expected_body_limit_bytes: BODY_LIMIT_BYTES,
    parent_evidence_sha256: PARENT_RECEIPT_HASHES,
    operator_transcript_used_as_evidence: false,
    validation_bypass_granted: false,
    returned_files_modified_by_codex: false,
    production_contact_performed_by_codex: false,
    production_mutation_performed: false,
    handoff_freeze_fixture_result: freeze.generated_handoff_fixture_result,
  };
  scanValueForSecrets(authority, 'authority');
  validateAuthorityObject(authority, inventory, options);
  ensureDir(path.dirname(options.authorityFile));
  writeJsonNoOverwriteOrIdentical(options.authorityFile, authority);
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-returned-authority-created',
        authority_file: options.authorityFile,
        authority_sha256: sha256File(options.authorityFile),
        tree_digest: authority.authoritative_tree_digest,
        safe_file_count: authority.authoritative_safe_file_count,
      },
      null,
      2,
    ),
  );
}

function verifyAuthority(options) {
  assert(options.evidenceDir, '--evidence-dir is required');
  verifyFreeze(options);
  const inventory = returnedSafeInventory(options.evidenceDir);
  const authority = readJsonValidated(options.authorityFile, path.basename(options.authorityFile));
  validateAuthorityObject(authority, inventory, options);
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-returned-authority-verified',
        authority_file: options.authorityFile,
        authority_sha256: sha256File(options.authorityFile),
        tree_digest: authority.authoritative_tree_digest,
        safe_file_count: authority.authoritative_safe_file_count,
      },
      null,
      2,
    ),
  );
  return authority;
}

function createReceipt(options) {
  assert(options.evidenceDir, '--evidence-dir is required');
  const authority = verifyAuthority(options);
  const parsed = parseEvidenceDir(options.evidenceDir);
  const analysis = analyzeEvidence(parsed);
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    milestone: RECEIPT_MILESTONE,
    handoff_milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    generated_at_utc: new Date().toISOString(),
    receipt_revision: CORRECTED_RECEIPT_REVISION,
    semantic_correction_class: SEMANTIC_CORRECTION_CLASS,
    verifier_revision: {
      source_commit: git(['rev-parse', 'HEAD']),
      script_sha256: sha256File(__filename),
    },
    historical_blocked_receipt: historicalBlockedReceipt(),
    contract_version: CONTRACT_VERSION,
    route: ROUTE,
    method: METHOD,
    content_type: CONTENT_TYPE,
    collection_utc: parsed.metadata.collection_utc,
    body_limit_bytes: BODY_LIMIT_BYTES,
    probe_sizes: {
      small: SMALL_BODY_BYTES,
      exact_limit: EXACT_BODY_BYTES,
      limit_plus_one: OVER_BODY_BYTES,
    },
    expected_status_model: Object.fromEntries(
      PROBES.map(([probeClass, targetClass, bytes, status]) => [
        `${probeClass}.${targetClass}`,
        { requested_bytes: bytes, expected_http_status: status },
      ]),
    ),
    parent_evidence_sha256: PARENT_RECEIPT_HASHES,
    returned_authority: {
      file: 'EXTERNAL_RETURNED_AUTHORITY_RECORD',
      schema_version: authority.schema_version,
      sha256: sha256File(options.authorityFile),
      tree_digest: authority.authoritative_tree_digest,
      safe_file_count: authority.authoritative_safe_file_count,
    },
    evidence_bundle: {
      directory: 'EXTERNAL_RETURNED_EVIDENCE_DIR',
      inventory: [...EVIDENCE_FILES],
      checksums_sha256: parsed.checksums,
      collector_metadata_sha256: sha256File(path.join(options.evidenceDir, 'collector-metadata.txt')),
      evidence_records_sha256: sha256File(path.join(options.evidenceDir, 'evidence-records.tsv')),
    },
    collector: {
      source_commit: parsed.metadata.source_commit,
      collector_sha256: parsed.metadata.collector_sha256,
      canonical_remote: parsed.metadata.canonical_remote,
      actual_request_count: Number(parsed.metadata.actual_request_count),
      max_request_count: Number(parsed.metadata.max_request_count),
      safe_stop_reason: parsed.metadata.safe_stop_reason,
    },
    safety_flags: {
      auth_credential_used: parsed.metadata.auth_credential_used === 'true',
      cookies: parsed.metadata.cookies === 'true',
      retries: parsed.metadata.retries === 'true',
      concurrency: Number(parsed.metadata.concurrency),
      payload_retained: parsed.metadata.payload_retained === 'true',
      response_retained: parsed.metadata.response_retained === 'true',
      headers_retained: parsed.metadata.headers_retained === 'true',
      mutation: parsed.metadata.mutation === 'true',
      database_write: false,
      production_contact_performed_by_codex: false,
    },
    probes: analysis.probes,
    outcome: analysis.outcome,
    blockers: analysis.blockers,
    vendor_configured_exact_limit: 'NOT_RECORDED',
    explicitly_not_evidence_for: [
      'previous_production_pointer',
      'long_term_stability',
      'error_burst',
      'agent_application_readiness',
      'tenant_application_readiness',
    ],
  };
  scanValueForSecrets(receipt, 'receipt');
  validateReceiptObject(receipt, { requireCompatibility: options.requireCompatibility });
  ensureDir(path.dirname(options.receiptFile));
  writeJsonNoOverwriteOrIdentical(options.receiptFile, receipt);
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-receipt-created',
        receipt: options.receiptFile,
        sha256: sha256File(options.receiptFile),
        outcome: receipt.outcome,
      },
      null,
      2,
    ),
  );
}

function verifyReceipt(options) {
  const receipt = readJsonValidated(options.receiptFile, path.basename(options.receiptFile));
  validateReceiptObject(receipt, { requireCompatibility: options.requireCompatibility });
  console.log(
    JSON.stringify(
      {
        status: 'production-edge-body-limit-receipt-verified',
        receipt: options.receiptFile,
        sha256: sha256File(options.receiptFile),
        outcome: receipt.outcome,
        strict_required: options.requireCompatibility,
      },
      null,
      2,
    ),
  );
}

function parseEvidenceDir(dir) {
  assert(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `evidence directory does not exist: ${dir}`);
  assertExactInventory(dir, EVIDENCE_FILES);
  const checksums = verifyChecksums(dir, ['collector-metadata.txt', 'evidence-records.tsv']);
  const metadataText = readAndValidateText(path.join(dir, 'collector-metadata.txt'), 'collector-metadata.txt');
  const recordsText = readAndValidateText(path.join(dir, 'evidence-records.tsv'), 'evidence-records.tsv');
  scanTextForSecrets(metadataText, 'collector-metadata.txt');
  scanTextForSecrets(recordsText, 'evidence-records.tsv');
  const metadata = parseMetadata(metadataText);
  const records = parseRecords(recordsText);
  validateMetadata(metadata);
  return { metadata, records, checksums: Object.fromEntries(checksums) };
}

function analyzeEvidence(parsed) {
  const blockers = [];
  const missingProbeBlockers = [];
  const probeObjects = {};
  for (const [probeClass, targetClass, requestedBytes, expectedStatus] of PROBES) {
    const key = `${probeClass}.${targetClass}`;
    const section = `probe.${key}`;
    const record = parsed.records.get(section);
    if (!record) {
      probeObjects[key] = { status: 'NOT_RECORDED', probe_class: probeClass, target_class: targetClass };
      missingProbeBlockers.push(`missing_probe:${key}`);
      continue;
    }
    const probe = {
      status: 'RECORDED',
      probe_class: probeClass,
      target_class: targetClass,
      requested_bytes: Number(required(record, 'requested_bytes', section)),
      generated_bytes: Number(required(record, 'generated_bytes', section)),
      uploaded_bytes: Number(required(record, 'uploaded_bytes', section)),
      upload_bytes_match: parseBoolean(required(record, 'upload_bytes_match', section)),
      curl_exit_code: Number(required(record, 'curl_exit_code', section)),
      curl_exit_class: required(record, 'curl_exit_class', section),
      http_status: Number(required(record, 'http_status', section)),
      expected_http_status: Number(required(record, 'expected_http_status', section)),
      http_status_match: parseBoolean(required(record, 'http_status_match', section)),
      tls_verification: required(record, 'tls_verification', section),
      auth_credential_used: parseBoolean(required(record, 'auth_credential_used', section)),
      cookies_used: parseBoolean(required(record, 'cookies_used', section)),
      retry_used: parseBoolean(required(record, 'retry_used', section)),
      mutation: parseBoolean(required(record, 'mutation', section)),
    };
    assert(Number.isSafeInteger(probe.requested_bytes), `invalid requested bytes for ${key}`);
    assert(Number.isSafeInteger(probe.generated_bytes), `invalid generated bytes for ${key}`);
    assert(Number.isSafeInteger(probe.uploaded_bytes), `invalid uploaded bytes for ${key}`);
    assert(probe.uploaded_bytes >= 0, `uploaded bytes cannot be negative for ${key}`);
    if (
      probe.requested_bytes !== requestedBytes ||
      probe.generated_bytes !== requestedBytes ||
      probe.expected_http_status !== expectedStatus
    ) {
      fail(`Probe contract mismatch for ${key}`);
    }
    if (probe.auth_credential_used || probe.cookies_used || probe.retry_used || probe.mutation) {
      blockers.push(`unsafe_probe_flag:${key}`);
    }
    if (probeClass === 'LIMIT_PLUS_ONE') {
      probe.upload_requirement = 'HTTP_413_EARLY_OR_FULL_UPLOAD_ALLOWED';
      probe.upper_control_result = classifyUpperControl(probe);
    } else {
      probe.upload_requirement = 'FULL_UPLOAD_REQUIRED';
      probe.upload_result = probe.uploaded_bytes === probe.requested_bytes ? 'FULL_UPLOAD' : 'SHORT_UPLOAD';
    }
    probeObjects[key] = probe;
  }

  const internalSmall = probeObjects['CONTROL_SMALL.INTERNAL_LOOPBACK'];
  const publicSmall = probeObjects['CONTROL_SMALL.PUBLIC_HTTPS'];
  const internalExact = probeObjects['EXACT_LIMIT.INTERNAL_LOOPBACK'];
  const publicExact = probeObjects['EXACT_LIMIT.PUBLIC_HTTPS'];
  const internalOver = probeObjects['LIMIT_PLUS_ONE.INTERNAL_LOOPBACK'];
  const publicOver = probeObjects['LIMIT_PLUS_ONE.PUBLIC_HTTPS'];

  const integrityOk =
    parsed.metadata.milestone === MILESTONE &&
    parsed.metadata.service === SERVICE_NAME &&
    parsed.metadata.contract_version === CONTRACT_VERSION &&
    parsed.metadata.route === ROUTE &&
    parsed.metadata.method === METHOD &&
    parsed.metadata.content_type === CONTENT_TYPE &&
    Number(parsed.metadata.body_limit_bytes) === BODY_LIMIT_BYTES &&
    Number(parsed.metadata.max_request_count) === MAX_REQUEST_COUNT &&
    Number(parsed.metadata.actual_request_count) <= MAX_REQUEST_COUNT &&
    parsed.metadata.auth_credential_used === 'false' &&
    parsed.metadata.cookies === 'false' &&
    parsed.metadata.retries === 'false' &&
    parsed.metadata.concurrency === '1' &&
    parsed.metadata.payload_retained === 'false' &&
    parsed.metadata.response_retained === 'false' &&
    parsed.metadata.headers_retained === 'false' &&
    parsed.metadata.mutation === 'false';
  if (!integrityOk) {
    blockers.push('evidence_integrity_contract_mismatch');
  }

  let outcome = 'SUCCESS';
  const safeStop = parsed.metadata.safe_stop_reason;
  if (!integrityOk || blockers.some((blocker) => blocker.startsWith('unsafe_probe'))) {
    outcome = 'BLOCKED_EVIDENCE_INTEGRITY';
  } else if (safeStop === 'INTERNAL_SMALL_FAILED' || safeStop === 'INTERNAL_EXACT_FAILED') {
    outcome = 'BLOCKED_APPLICATION_BODY_LIMIT_BASELINE';
    blockers.push('internal_application_baseline_mismatch');
    blockers.push(...missingProbeBlockers);
  } else if (safeStop === 'PUBLIC_SMALL_FAILED') {
    outcome = 'BLOCKED_PUBLIC_EDGE_UNAVAILABLE';
    blockers.push('public_control_small_mismatch');
    blockers.push(...missingProbeBlockers);
  } else if (missingProbeBlockers.length > 0) {
    outcome = 'BLOCKED_EVIDENCE_INTEGRITY';
    blockers.push(...missingProbeBlockers);
  } else if (!fullUploadProbePassed(internalSmall) || !fullUploadProbePassed(internalExact)) {
    outcome = 'BLOCKED_APPLICATION_BODY_LIMIT_BASELINE';
    blockers.push('internal_application_baseline_mismatch');
  } else if (!fullUploadProbePassed(publicSmall)) {
    outcome = 'BLOCKED_PUBLIC_EDGE_UNAVAILABLE';
    blockers.push('public_control_small_mismatch');
  } else if (publicTlsFailed(publicSmall) || publicTlsFailed(publicExact) || publicTlsFailed(publicOver)) {
    outcome = 'BLOCKED_TLS';
    blockers.push('public_tls_verification_failed');
  } else if (!fullUploadProbePassed(publicExact) || publicExact.uploaded_bytes !== EXACT_BODY_BYTES) {
    outcome = 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW';
    blockers.push('public_exact_limit_not_forwarded_to_auth_boundary');
  } else if (!upperControlPassed(internalOver)) {
    outcome = 'BLOCKED_UNEXPECTED_UPPER_CONTROL';
    blockers.push('internal_limit_plus_one_control_mismatch');
  } else if (!upperControlPassed(publicOver)) {
    outcome = 'BLOCKED_UNEXPECTED_UPPER_CONTROL';
    blockers.push('public_limit_plus_one_control_mismatch');
  }

  return { probes: probeObjects, outcome, blockers: [...new Set(blockers)] };
}

function validateReceiptObject(receipt, options = {}) {
  scanValueForSecrets(receipt, 'receipt');
  assert(receipt.schema_version === RECEIPT_SCHEMA_VERSION, 'receipt schema version mismatch');
  assert(receipt.milestone === RECEIPT_MILESTONE && receipt.handoff_milestone === MILESTONE && receipt.service === SERVICE_NAME, 'receipt identity mismatch');
  assert(receipt.contract_version === CONTRACT_VERSION, 'receipt contract mismatch');
  assert(receipt.route === ROUTE && receipt.method === METHOD && receipt.content_type === CONTENT_TYPE, 'receipt route contract mismatch');
  assert(typeof receipt.collection_utc === 'string' && !Number.isNaN(Date.parse(receipt.collection_utc)), 'receipt collection UTC mismatch');
  assert(receipt.body_limit_bytes === BODY_LIMIT_BYTES, 'receipt body limit mismatch');
  assert(receipt.returned_authority?.schema_version === AUTHORITY_SCHEMA_VERSION, 'receipt authority schema mismatch');
  assert(typeof receipt.returned_authority?.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(receipt.returned_authority.sha256), 'receipt authority hash mismatch');
  assert(typeof receipt.returned_authority?.tree_digest === 'string' && /^[a-f0-9]{64}$/u.test(receipt.returned_authority.tree_digest), 'receipt authority tree digest mismatch');
  assert(receipt.returned_authority?.safe_file_count === EVIDENCE_FILES.length, 'receipt authority file count mismatch');
  assert(['SUCCESS', 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW', 'BLOCKED_APPLICATION_BODY_LIMIT_BASELINE', 'BLOCKED_PUBLIC_EDGE_UNAVAILABLE', 'BLOCKED_TLS', 'BLOCKED_EVIDENCE_INTEGRITY', 'BLOCKED_UNEXPECTED_UPPER_CONTROL', 'OPERATOR_ACTION_REQUIRED'].includes(receipt.outcome), `unknown receipt outcome: ${receipt.outcome}`);
  assert(receipt.safety_flags.auth_credential_used === false, 'receipt must not use auth credentials');
  assert(receipt.safety_flags.cookies === false, 'receipt must not use cookies');
  assert(receipt.safety_flags.retries === false, 'receipt must not use retries');
  assert(receipt.safety_flags.concurrency === 1, 'receipt concurrency must be 1');
  assert(receipt.safety_flags.payload_retained === false, 'receipt must not retain payload');
  assert(receipt.safety_flags.response_retained === false, 'receipt must not retain response');
  assert(receipt.safety_flags.headers_retained === false, 'receipt must not retain headers');
  assert(receipt.safety_flags.mutation === false, 'receipt must not mutate production');
  assert(receipt.safety_flags.database_write === false, 'receipt must not write database');
  if (options.requireCompatibility && receipt.outcome !== 'SUCCESS') {
    fail(`edge body-limit compatibility was required but outcome is ${receipt.outcome}`);
  }
  if (receipt.outcome === 'SUCCESS') {
    assert(receipt.receipt_revision === CORRECTED_RECEIPT_REVISION, 'SUCCESS requires corrected receipt revision');
    assert(receipt.semantic_correction_class === SEMANTIC_CORRECTION_CLASS, 'SUCCESS requires early-rejection semantic correction class');
    assert(receipt.historical_blocked_receipt?.sha256 === HISTORICAL_BLOCKED_RECEIPT_SHA256, 'SUCCESS must preserve historical blocked receipt identity');
    assert(isGitSha(receipt.verifier_revision?.source_commit), 'SUCCESS must bind verifier source commit');
    assert(/^[a-f0-9]{64}$/u.test(receipt.verifier_revision?.script_sha256 ?? ''), 'SUCCESS must bind verifier script hash');
    const internalExact = receipt.probes?.['EXACT_LIMIT.INTERNAL_LOOPBACK'];
    const exact = receipt.probes?.['EXACT_LIMIT.PUBLIC_HTTPS'];
    assert(internalExact?.http_status === 401, 'SUCCESS requires internal exact-limit 401');
    assert(internalExact?.uploaded_bytes === EXACT_BODY_BYTES, 'SUCCESS requires internal exact full upload');
    assert(exact?.http_status === 401, 'SUCCESS requires public exact-limit 401');
    assert(exact?.uploaded_bytes === EXACT_BODY_BYTES, 'SUCCESS requires exact upload byte count');
    assert(exact?.tls_verification === 'PASSED', 'SUCCESS requires public TLS verification');
    for (const key of ['LIMIT_PLUS_ONE.INTERNAL_LOOPBACK', 'LIMIT_PLUS_ONE.PUBLIC_HTTPS']) {
      const upper = receipt.probes?.[key];
      assert(['FULL_UPLOAD_REJECTED_413', 'EARLY_REJECTION_413'].includes(upper?.upper_control_result), `SUCCESS requires valid upper control: ${key}`);
    }
  }
}

function returnedSafeInventory(dir) {
  assert(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `evidence directory does not exist: ${dir}`);
  assertExactInventory(dir, EVIDENCE_FILES);
  return EVIDENCE_FILES.map((relativePath) => {
    const absolute = path.join(dir, relativePath);
    const stat = fs.lstatSync(absolute);
    assert(stat.size >= 0 && stat.size <= 1024 * 1024, `unreasonable returned evidence size: ${relativePath}`);
    return {
      relative_path: relativePath,
      byte_size: stat.size,
      sha256: sha256File(absolute),
    };
  });
}

function returnedTreeDigest(inventory) {
  return createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
}

function validateAuthorityObject(authority, inventory, options) {
  scanValueForSecrets(authority, 'authority');
  assert(authority.schema_version === AUTHORITY_SCHEMA_VERSION, 'authority schema version mismatch');
  assert(authority.record_type === 'PRODUCTION_EDGE_BODY_LIMIT_RETURNED_AUTHORITY', 'authority record type mismatch');
  assert(authority.milestone === RECEIPT_MILESTONE && authority.handoff_milestone === MILESTONE, 'authority milestone mismatch');
  assert(authority.service === SERVICE_NAME && authority.environment === 'production', 'authority service/environment mismatch');
  assert(authority.submission_kind === 'LANDED_HANDOFF_V1_EDGE_BODY_PROBE', 'authority submission kind mismatch');
  assert(authority.authority_source === 'HUMAN_OPERATOR_EXPLICIT_SUBMISSION', 'authority source mismatch');
  assert(authority.selected_input_alias === 'production-edge-body-limit-returned-v1', 'authority selected input alias mismatch');
  assert(authority.authoritative_tree_digest === returnedTreeDigest(inventory), 'authority returned tree digest mismatch');
  assert(authority.authoritative_safe_file_count === EVIDENCE_FILES.length, 'authority file count mismatch');
  assert(JSON.stringify(authority.safe_inventory) === JSON.stringify(inventory), 'authority safe inventory mismatch');
  assert(authority.expected_handoff_source_commit === readJsonValidated(path.join(options.handoffDir, 'manifest.json'), 'manifest.json').source_commit, 'authority handoff source mismatch');
  assert(authority.expected_handoff_manifest_sha256 === sha256File(path.join(options.handoffDir, 'manifest.json')), 'authority manifest hash mismatch');
  assert(authority.expected_handoff_collector_sha256 === sha256File(path.join(options.handoffDir, HANDOFF_COLLECTOR)), 'authority collector hash mismatch');
  assert(authority.expected_handoff_contract_sha256 === sha256File(path.join(options.handoffDir, HANDOFF_CONTRACT)), 'authority contract hash mismatch');
  assert(authority.expected_handoff_freeze_sha256 === sha256File(options.freezeFile), 'authority freeze hash mismatch');
  assert(authority.expected_contract_version === CONTRACT_VERSION, 'authority contract version mismatch');
  assert(authority.expected_body_limit_bytes === BODY_LIMIT_BYTES, 'authority body limit mismatch');
  assert(JSON.stringify(authority.parent_evidence_sha256) === JSON.stringify(PARENT_RECEIPT_HASHES), 'authority parent hash mismatch');
  for (const flag of [
    'operator_transcript_used_as_evidence',
    'validation_bypass_granted',
    'returned_files_modified_by_codex',
    'production_contact_performed_by_codex',
    'production_mutation_performed',
  ]) {
    assert(authority[flag] === false, `authority flag must be false: ${flag}`);
  }
  assert(authority.handoff_freeze_fixture_result === 'PASSED', 'authority freeze fixture result mismatch');
}

function validateMetadata(metadata) {
  assertExactKeys(Object.keys(metadata), [...EXPECTED_METADATA_KEYS], 'collector metadata');
  assert(metadata.collector === 'production-edge-body-limit-collector', 'collector metadata name mismatch');
  assert(metadata.milestone === MILESTONE, 'metadata milestone mismatch');
  assert(metadata.service === SERVICE_NAME, 'metadata service mismatch');
  assert(metadata.contract_version === CONTRACT_VERSION, 'metadata contract mismatch');
  assert(metadata.canonical_remote === CANONICAL_REMOTE, 'metadata canonical remote mismatch');
  assert(metadata.route === ROUTE && metadata.method === METHOD && metadata.content_type === CONTENT_TYPE, 'metadata route mismatch');
  assert(Number(metadata.body_limit_bytes) === BODY_LIMIT_BYTES, 'metadata body limit mismatch');
  assert(Number(metadata.small_body_bytes) === SMALL_BODY_BYTES, 'metadata small size mismatch');
  assert(Number(metadata.exact_body_bytes) === EXACT_BODY_BYTES, 'metadata exact size mismatch');
  assert(Number(metadata.over_body_bytes) === OVER_BODY_BYTES, 'metadata over size mismatch');
}

function parseMetadata(text) {
  const result = {};
  for (const [index, line] of text.split(/\n/u).entries()) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/u);
    assert(match, `metadata line ${index + 1} is malformed`);
    const [, key, value] = match;
    assert(!Object.hasOwn(result, key), `duplicate metadata key ${key}`);
    result[key] = value;
  }
  return result;
}

function parseRecords(text) {
  const result = new Map();
  for (const [index, line] of text.split(/\n/u).entries()) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    assert(parts.length === 3, `evidence record line ${index + 1} is malformed`);
    const [section, key, value] = parts;
    assert(/^probe\.(CONTROL_SMALL|EXACT_LIMIT|LIMIT_PLUS_ONE)\.(INTERNAL_LOOPBACK|PUBLIC_HTTPS)$/u.test(section), `unexpected evidence section ${section}`);
    assert(EXPECTED_RECORD_KEYS.has(key), `unexpected evidence key ${key}`);
    if (!result.has(section)) {
      result.set(section, {});
    }
    const sectionRecords = result.get(section);
    assert(!Object.hasOwn(sectionRecords, key), `duplicate evidence key ${section}.${key}`);
    sectionRecords[key] = value;
  }
  return result;
}

function createContract(sourceCommit) {
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
    application_request_body_contract: verifyApplicationContract(),
    probe: {
      route: ROUTE,
      method: METHOD,
      content_type: CONTENT_TYPE,
      body_shape: '{"probe":"aaaa..."}',
      auth_credential_used: false,
      cookies_used: false,
      business_write_expected: false,
      max_request_count: MAX_REQUEST_COUNT,
      request_order: PROBES.map(([probeClass, targetClass, requestedBytes, expectedStatus]) => ({
        probe_class: probeClass,
        target_class: targetClass,
        requested_bytes: requestedBytes,
        expected_http_status: expectedStatus,
      })),
    },
    collector_dependency_mode: 'SELF_CONTAINED_READ_ONLY_HTTP_PROBE',
    host_runtime_dependencies: ['bash', 'curl', 'sha256sum', 'wc', 'head', 'tr', 'mktemp', 'POSIX utilities'],
    output_inventory: [...EVIDENCE_FILES],
    receipt_model: {
      file: 'production-edge-body-limit-receipt.json',
      strict_flag: '--require-edge-body-limit-compatibility',
      success: 'public exact-limit status and upload bytes match internal application boundary',
      vendor_configured_exact_limit: 'NOT_RECORDED',
    },
    parent_evidence_sha256: PARENT_RECEIPT_HASHES,
  };
}

function createManifest(handoffDir, sourceCommit, generatedAt) {
  return {
    schema_version: 1,
    bundle_type: 'production-edge-body-limit-handoff',
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    canonical_remote: CANONICAL_REMOTE,
    source_commit: sourceCommit,
    generated_at_utc: generatedAt,
    generated_by: 'scripts/production-edge-body-limit-evidence.mjs',
    collector: {
      filename: HANDOFF_COLLECTOR,
      sha256: sha256File(path.join(handoffDir, HANDOFF_COLLECTOR)),
      executable_intended: true,
    },
    contract: {
      filename: HANDOFF_CONTRACT,
      sha256: sha256File(path.join(handoffDir, HANDOFF_CONTRACT)),
      version: CONTRACT_VERSION,
    },
    route: ROUTE,
    method: METHOD,
    content_type: CONTENT_TYPE,
    internal_base: INTERNAL_BASE,
    public_base: PUBLIC_BASE,
    confirm_public_host: CONFIRM_PUBLIC_HOST,
    body_limit_bytes: BODY_LIMIT_BYTES,
    probe_sizes: {
      small: SMALL_BODY_BYTES,
      exact_limit: EXACT_BODY_BYTES,
      limit_plus_one: OVER_BODY_BYTES,
    },
    max_request_count: MAX_REQUEST_COUNT,
    expected_output_inventory: [...EVIDENCE_FILES],
    parent_evidence_sha256: PARENT_RECEIPT_HASHES,
    dependency_mode: 'SELF_CONTAINED_READ_ONLY_HTTP_PROBE',
    evidence_collected: false,
    production_contact: false,
    mutation: false,
    database_write: false,
    auth_credential_used: false,
    backup_restore: false,
    publication_tag_release: false,
    secrets: false,
  };
}

function validateContract(contract) {
  assert(contract.schema_version === 1, 'contract schema version mismatch');
  assert(contract.contract_version === CONTRACT_VERSION, 'contract version mismatch');
  assert(contract.milestone === MILESTONE && contract.service === SERVICE_NAME, 'contract identity mismatch');
  assert(contract.application_request_body_contract?.body_limit_bytes === BODY_LIMIT_BYTES, 'contract body limit mismatch');
  assert(contract.probe?.route === ROUTE && contract.probe?.method === METHOD, 'contract route mismatch');
  assert(JSON.stringify(contract.output_inventory) === JSON.stringify(EVIDENCE_FILES), 'contract output inventory mismatch');
}

function validateManifest(manifest, checksumMap) {
  assert(manifest.schema_version === 1, 'manifest schema version mismatch');
  assert(manifest.bundle_type === 'production-edge-body-limit-handoff', 'manifest type mismatch');
  assert(manifest.contract_version === CONTRACT_VERSION, 'manifest contract mismatch');
  assert(manifest.milestone === MILESTONE && manifest.service === SERVICE_NAME, 'manifest identity mismatch');
  assert(manifest.canonical_remote === CANONICAL_REMOTE, 'manifest remote mismatch');
  assert(isGitSha(manifest.source_commit), 'manifest source commit must be a 40-hex SHA');
  assert(manifest.collector?.filename === HANDOFF_COLLECTOR, 'manifest collector filename mismatch');
  assert(manifest.collector?.sha256 === checksumMap.get(HANDOFF_COLLECTOR), 'manifest collector hash mismatch');
  assert(manifest.contract?.filename === HANDOFF_CONTRACT, 'manifest contract filename mismatch');
  assert(manifest.contract?.sha256 === checksumMap.get(HANDOFF_CONTRACT), 'manifest contract hash mismatch');
  assert(manifest.route === ROUTE && manifest.method === METHOD && manifest.content_type === CONTENT_TYPE, 'manifest route mismatch');
  assert(manifest.internal_base === INTERNAL_BASE && manifest.public_base === PUBLIC_BASE, 'manifest target mismatch');
  assert(manifest.body_limit_bytes === BODY_LIMIT_BYTES, 'manifest body limit mismatch');
  assert(manifest.max_request_count === MAX_REQUEST_COUNT, 'manifest max request mismatch');
  assert(JSON.stringify(manifest.expected_output_inventory) === JSON.stringify(EVIDENCE_FILES), 'manifest output inventory mismatch');
  for (const flag of ['evidence_collected', 'production_contact', 'mutation', 'database_write', 'auth_credential_used', 'backup_restore', 'publication_tag_release', 'secrets']) {
    assert(manifest[flag] === false, `manifest flag must be false: ${flag}`);
  }
}

function renderReadme(sourceCommit, generatedAt) {
  return `# MS-019E Production Edge Body-Limit Handoff v1

This bundle prepares one read-only operator collection for the main-service
production edge request-body compatibility boundary. It is not production
evidence by itself and does not mark edge body-limit verification as accepted.

## Contract

- Route: POST /agent/entries
- Content-Type: application/json
- Application body limit: 5242880 bytes
- Probe body shape: {"probe":"aaaa..."}
- Credentials: none
- Cookies: none
- Retries: none
- Concurrency: 1
- Maximum requests: 6
- Internal target: http://127.0.0.1:3200
- Public target: https://rss.habersoft.com

The probe is intentionally missing the Agent credential. Small and exact-limit
requests should reach the application auth boundary and return 401. The
limit+1 request should return 413. The collector writes exactly:

- checksums.sha256
- collector-metadata.txt
- evidence-records.tsv

It does not retain payload files, response bodies, headers, or operational
logs.

## Operator Collection

\`\`\`sh
cd <approved-ms-019e-handoff-v1-dir>
sha256sum -c checksums.sha256
bash -n collect-production-edge-body-limit-evidence.sh

./collect-production-edge-body-limit-evidence.sh \\
  --confirm-public-host rss.habersoft.com \\
  --output-dir <new-empty-output-dir>
\`\`\`

Return only the three output files to the MS-019E returned evidence directory.

Generated from repository commit ${sourceCommit} at ${generatedAt}.
`;
}

function staticScanCollector(text) {
  const forbidden = [
    { label: 'Agent credential header', pattern: /\bX-Agent-Key\b/u },
    { label: 'authorization credential', pattern: /\bAuthorization\s*:|\bBearer\b|\bJWT\b/u },
    { label: 'cookie header', pattern: /\bCookie\s*:/u },
    { label: 'TLS bypass', pattern: /(^|\s)(?:-k|--insecure)(?:\s|$)/u },
    { label: 'manual DNS override', pattern: /\b--resolve\b/u },
    { label: 'retry', pattern: /\b--retry\b|\bretry\b/u },
    { label: 'concurrency', pattern: /\bparallel\b|\bxargs\s+-P\b/u },
    { label: 'shell tracing', pattern: /\bset\s+-x\b|\bbash\s+-x\b/u },
    { label: 'environment dump', pattern: /(^|[;&|()]\s*)(?:env|printenv)(?:\s|$)/mu },
    { label: 'Docker command', pattern: /(^|[;&|()]\s*)docker(?:\s|$)/mu },
    { label: 'Git command', pattern: /(^|[;&|()]\s*)git(?:\s|$)/mu },
    { label: 'database command', pattern: /(^|[;&|()]\s*)(?:psql|redis-cli)(?:\s|$)/mu },
    { label: 'Node or package manager', pattern: /(^|[;&|()]\s*)(?:node|npm|pnpm|yarn)(?:\s|$)/mu },
    { label: 'service mutation', pattern: /(^|[;&|()]\s*)(?:systemctl|service)(?:\s|$)/mu },
    { label: 'raw retention wording', pattern: /\b(?:response-body|request-payload|headers-file)\b/u },
    { label: 'arbitrary target option', pattern: /--(?:url|route|method|size|public-url|internal-url|host)\b/u },
  ];
  for (const { label, pattern } of forbidden) {
    assert(!pattern.test(text), `collector contains forbidden pattern: ${label}`);
  }
  assert(text.includes('curl -q '), 'collector must invoke curl with -q first');
  assert(text.includes('--header "Content-Type: application/json"'), 'collector must set content type');
  assert(text.includes('--header "Expect:"'), 'collector must clear Expect header');
  assert(text.includes('--data-binary @"$payload_file"'), 'collector must use --data-binary @file');
  assert(text.includes('PUBLIC_BASE="https://rss.habersoft.com"'), 'collector public target must be pinned');
  assert(text.includes('INTERNAL_BASE="http://127.0.0.1:3200"'), 'collector internal target must be pinned');
  assert(text.includes('MAX_REQUEST_COUNT=6'), 'collector max request count must be 6');
  assert(!text.includes('\r'), 'collector must be LF-only');
}

function scanTextForSecrets(text, label) {
  const patterns = [
    /DATABASE_URL\s*=/iu,
    /POSTGRES_PASSWORD\s*=/iu,
    /TENANT_RATE_LIMIT_KEY_SECRET\s*=/iu,
    /AGENT_KEY\s*=/iu,
    /Authorization\s*:/iu,
    /Bearer\s+[A-Za-z0-9._-]+/u,
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
    /Cookie\s*:/iu,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
    /(?:^|[\s`"'(<])(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp)\/)/u,
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/u,
    /-----BEGIN CERTIFICATE-----/u,
    /\braw_log\b|\braw_body\b|\brequest_payload\b/iu,
  ];
  for (const pattern of patterns) {
    assert(!pattern.test(text), `secret/privacy pattern in ${label}: ${pattern}`);
  }
}

function scanValueForSecrets(value, trail) {
  if (typeof value === 'string') {
    scanTextForSecrets(value, trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValueForSecrets(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      assert(!/(authorization|cookie|credential|private_key|database_url|agent_key)$/iu.test(key), `forbidden field ${trail}.${key}`);
      scanValueForSecrets(nested, `${trail}.${key}`);
    }
  }
}

function assertBashSyntax(scriptFile) {
  const bash = process.platform === 'win32' ? 'bash.exe' : 'bash';
  const candidates = process.platform === 'win32' ? windowsBashPathCandidates(scriptFile) : [scriptFile];
  const results = candidates.map((candidate) => spawnSync(bash, ['-n', candidate], { encoding: 'utf8', shell: false }));
  const ok = results.find((result) => result.status === 0);
  if (!ok) {
    const detail = results.at(-1)?.stderr?.trim() || results.at(-1)?.error?.message || 'bash -n failed';
    fail(`Bash syntax check failed for ${scriptFile}: ${detail}`);
  }
}

function windowsBashPathCandidates(nativePath) {
  const normalized = path.resolve(nativePath).replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  if (!match) {
    return [normalized];
  }
  return [`/mnt/${match[1].toLowerCase()}/${match[2]}`, `/${match[1].toLowerCase()}/${match[2]}`, normalized];
}

function verifyChecksums(root, expectedFiles) {
  const content = readAndValidateText(path.join(root, 'checksums.sha256'), 'checksums.sha256').trim();
  const checksums = new Map();
  for (const line of content.split(/\n/u)) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
    assert(match, `invalid checksum line: ${line}`);
    const [, hash, relative] = match;
    assert(expectedFiles.includes(relative), `unexpected checksum path ${relative}`);
    assert(!checksums.has(relative), `duplicate checksum path ${relative}`);
    const actual = sha256File(path.join(root, relative));
    assert(actual === hash, `checksum mismatch for ${relative}`);
    checksums.set(relative, hash);
  }
  assert(JSON.stringify([...checksums.keys()].sort()) === JSON.stringify([...expectedFiles].sort()), 'checksum inventory mismatch');
  return checksums;
}

function writeChecksums(root, files) {
  const lines = files.map((file) => `${sha256File(path.join(root, file))}  ${file}`);
  writeText(path.join(root, 'checksums.sha256'), `${lines.join('\n')}\n`, 0o644);
}

function assertExactInventory(root, expected) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `symlink not allowed: ${entry.name}`);
    assert(entry.isFile(), `unexpected non-file entry: ${entry.name}`);
    names.push(entry.name);
  }
  assert(JSON.stringify(names.sort()) === JSON.stringify([...expected].sort()), `inventory mismatch in ${root}`);
}

function readAndValidateText(file, label) {
  const stat = fs.lstatSync(file);
  assert(!stat.isSymbolicLink(), `symlink not allowed: ${label}`);
  assert(stat.isFile(), `expected file: ${label}`);
  const text = readText(file);
  assert(!text.includes('\r'), `${label} contains CR bytes`);
  return text;
}

function readJsonValidated(file, label) {
  return JSON.parse(readAndValidateText(file, label));
}

function prepareEmptyExternalDir(dir) {
  assert(!isInsideRepo(dir), 'handoff output must be outside the application repository');
  if (fs.existsSync(dir)) {
    assert(fs.statSync(dir).isDirectory(), 'output path must be a directory');
    assert(fs.readdirSync(dir).length === 0, 'output directory must be empty');
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function isInsideRepo(file) {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJsonNoOverwriteOrIdentical(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file)) {
    assert(fs.readFileSync(file, 'utf8') === text, `refusing to overwrite non-identical file: ${file}`);
    return;
  }
  writeText(file, text, 0o600);
}

function assertNoOverwrite(file) {
  assert(!fs.existsSync(file), `refusing to overwrite existing file: ${file}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, value, mode) {
  fs.writeFileSync(file, value, { encoding: 'utf8', mode });
  if (process.platform !== 'win32') {
    fs.chmodSync(file, mode);
  }
}

function writeJson(file, value, mode) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', shell: false });
  assert(result.status === 0, `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function required(record, key, section) {
  assert(Object.hasOwn(record, key), `missing record ${section}.${key}`);
  return record[key];
}

function validHttpResponse(probe) {
  return probe?.status === 'RECORDED' && probe.curl_exit_code === 0 && probe.curl_exit_class === 'OK' && probe.http_status > 0;
}

function fullUploadProbePassed(probe) {
  return probe?.status === 'RECORDED' && probe.http_status_match === true && probe.upload_bytes_match === true && probe.curl_exit_code === 0;
}

function upperControlPassed(probe) {
  return ['FULL_UPLOAD_REJECTED_413', 'EARLY_REJECTION_413'].includes(probe?.upper_control_result);
}

function classifyUpperControl(probe) {
  if (!validHttpResponse(probe) || probe.http_status !== 413 || probe.expected_http_status !== 413 || probe.http_status_match !== true) {
    return 'INVALID_UPPER_CONTROL';
  }
  if (probe.generated_bytes !== probe.requested_bytes) {
    return 'INVALID_UPPER_CONTROL';
  }
  if (probe.uploaded_bytes > probe.requested_bytes) {
    return 'INVALID_UPPER_CONTROL';
  }
  if (probe.uploaded_bytes === probe.requested_bytes) {
    return 'FULL_UPLOAD_REJECTED_413';
  }
  return 'EARLY_REJECTION_413';
}

function publicTlsFailed(probe) {
  return probe?.target_class === 'PUBLIC_HTTPS' && probe.tls_verification === 'FAILED';
}

function historicalBlockedReceipt() {
  return {
    file: 'production-edge-body-limit-receipt.json',
    sha256: fs.existsSync(DEFAULT_HISTORICAL_BLOCKED_RECEIPT_FILE)
      ? sha256File(DEFAULT_HISTORICAL_BLOCKED_RECEIPT_FILE)
      : HISTORICAL_BLOCKED_RECEIPT_SHA256,
    preservation: 'HISTORICAL_BLOCKED_RECEIPT_UPPER_CONTROL_UPLOAD_EQUALITY',
  };
}

function parseBoolean(value) {
  assert(value === 'true' || value === 'false', `invalid boolean ${value}`);
  return value === 'true';
}

function isGitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function assertExactKeys(actualKeys, expectedKeys, label) {
  assert(JSON.stringify([...actualKeys].sort()) === JSON.stringify([...expectedKeys].sort()), `${label} field inventory mismatch`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `Usage:
  node scripts/production-edge-body-limit-evidence.mjs contract:verify
  node scripts/production-edge-body-limit-evidence.mjs handoff [--output-dir <dir>]
  node scripts/production-edge-body-limit-evidence.mjs handoff:verify [--handoff-dir <dir>]
  node scripts/production-edge-body-limit-evidence.mjs handoff:freeze [--handoff-dir <dir>] [--freeze-file <file>] [--fixture-result PASSED]
  node scripts/production-edge-body-limit-evidence.mjs handoff:freeze:verify [--handoff-dir <dir>] [--freeze-file <file>]
  node scripts/production-edge-body-limit-evidence.mjs authority:create --evidence-dir <dir> [--authority-file <file>] [--handoff-dir <dir>] [--freeze-file <file>]
  node scripts/production-edge-body-limit-evidence.mjs authority:verify --evidence-dir <dir> [--authority-file <file>] [--handoff-dir <dir>] [--freeze-file <file>]
  node scripts/production-edge-body-limit-evidence.mjs receipt:create --evidence-dir <dir> [--authority-file <file>] [--handoff-dir <dir>] [--freeze-file <file>] [--output-file <file>]
  node scripts/production-edge-body-limit-evidence.mjs receipt:verify --receipt-file <file> [--require-edge-body-limit-compatibility]
`;
}

async function main() {
  const [command = '', ...rest] = process.argv.slice(2);
  const { options } = parseArgs(rest);
  switch (command) {
    case 'contract:verify':
      console.log(JSON.stringify({ status: 'application-body-contract-verified', ...verifyApplicationContract() }, null, 2));
      break;
    case 'handoff':
    case 'handoff:generate':
      generateHandoff(options);
      break;
    case 'handoff:verify':
      verifyHandoff(options);
      break;
    case 'handoff:freeze':
      freezeHandoff(options);
      break;
    case 'handoff:freeze:verify':
      verifyFreeze(options);
      break;
    case 'authority:create':
      createAuthority(options);
      break;
    case 'authority:verify':
      verifyAuthority(options);
      break;
    case 'receipt:create':
      createReceipt(options);
      break;
    case 'receipt:verify':
      verifyReceipt(options);
      break;
    case '--help':
    case '-h':
      process.stdout.write(usage());
      break;
    default:
      process.stderr.write(usage());
      fail(`Unknown command: ${command || '<missing>'}`);
  }
}
