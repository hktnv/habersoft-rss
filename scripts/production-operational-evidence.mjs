import crypto from "node:crypto";
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
import { fileURLToPath } from "node:url";
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_PUBLIC_ROUTES,
  EXPECTED_SERVICES,
  RELEASE_IDENTITY
} from "./release-identity.mjs";

const CANONICAL_REMOTE = "https://github.com/hktnv/habersoft-rss";
const EXPECTED_PUBLIC_BASE_URL = "https://rss.habersoft.com";
const EXPECTED_LOOPBACK_BASE_URL = "http://127.0.0.1:3200";
const CONTRACT_VERSION = "production-operational-evidence-v1";
const SCRIPT_NAME = "production-operational-evidence";
const COLLECTOR_SOURCE = "scripts/production-operational-evidence-collector.sh";
const COLLECTOR_BUNDLE_FILE = "collect-production-operational-evidence.sh";
const RECEIPT_FILE = "production-operational-evidence-receipt.json";
const EVIDENCE_FILES = Object.freeze(["checksums.sha256", "collector-metadata.txt", "evidence-records.tsv"]);

export const HANDOFF_FILES = Object.freeze([
  "README.md",
  "checksums.sha256",
  COLLECTOR_BUNDLE_FILE,
  "evidence-contract.json",
  "manifest.json"
]);

const HANDOFF_CHECKSUM_FILES = Object.freeze([
  "README.md",
  COLLECTOR_BUNDLE_FILE,
  "evidence-contract.json",
  "manifest.json"
]);

const HANDOFF_PAYLOAD_FILES = Object.freeze([
  "README.md",
  COLLECTOR_BUNDLE_FILE,
  "evidence-contract.json"
]);

const SAFETY_FLAG_KEYS = Object.freeze([
  "production_contact_performed",
  "production_mutation_performed",
  "evidence_collected",
  "secrets_included",
  "deployment_performed",
  "backup_performed",
  "restore_performed",
  "artifact_published",
  "git_tag_created",
  "github_release_created"
]);

const STATUS_VALUES = new Set([
  "PASSED",
  "FAILED",
  "NOT_RECORDED",
  "NOT_APPLICABLE",
  "TOOL_UNAVAILABLE",
  "PARTIAL",
  "BLOCKED",
  "DIRECT_OBSERVED",
  "CONTRACT_DERIVED",
  "NOT_PERFORMED",
  "NOT_CREATED"
]);

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = process.cwd();

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);

  try {
    switch (command) {
      case "handoff":
      case "handoff:generate":
        generateHandoff(args);
        break;
      case "handoff:verify":
      case "verify-handoff":
        verifyHandoffCommand(args);
        break;
      case "receipt:create":
        createReceiptCommand(args);
        break;
      case "receipt:verify":
      case "verify-receipt":
        verifyReceiptCommand(args);
        break;
      default:
        fail("usage: production-operational-evidence <handoff|handoff:verify|receipt:create|receipt:verify>");
    }
  } catch (error) {
    fail(error.message);
  }
}

export function generateHandoff(args) {
  const outputDir = requiredExternalPath(args.output ?? args["output-dir"], "output");
  prepareEmptyOutputDir(outputDir);

  const generatedAt = new Date().toISOString();
  const generationSourceCommit = gitOutput(["rev-parse", "HEAD"]);
  const collectorText = readText(path.resolve(COLLECTOR_SOURCE)).replaceAll("__MS019A_SOURCE_COMMIT__", generationSourceCommit);

  writeText(path.join(outputDir, COLLECTOR_BUNDLE_FILE), collectorText, 0o755);
  writeText(path.join(outputDir, "README.md"), renderHandoffReadme(generatedAt), 0o644);
  writeJson(path.join(outputDir, "evidence-contract.json"), createEvidenceContract(), 0o644);

  const collectorSha = sha256(readFileSync(path.join(outputDir, COLLECTOR_BUNDLE_FILE)));
  const manifest = createHandoffManifest(outputDir, generatedAt, generationSourceCommit, collectorSha);
  writeJson(path.join(outputDir, "manifest.json"), manifest, 0o644);
  writeChecksums(outputDir, HANDOFF_CHECKSUM_FILES);

  const result = verifyHandoffBundle(outputDir);
  console.log(JSON.stringify({
    status: "production-operational-evidence-handoff-generated",
    bundle: outputDir,
    verified: result.ok,
    manifest_sha256: sha256(readFileSync(path.join(outputDir, "manifest.json"))),
    collector_sha256: collectorSha,
    evidence_collected: false,
    production_contact_performed: false,
    production_mutation_performed: false
  }, null, 2));
}

export function verifyHandoffCommand(args) {
  const bundle = requiredExternalPath(args.bundle ?? args.input, "bundle");
  const result = verifyHandoffBundle(bundle);
  console.log(JSON.stringify({
    status: "production-operational-evidence-handoff-verified",
    bundle,
    files: result.files,
    manifest_sha256: sha256(readFileSync(path.join(bundle, "manifest.json"))),
    collector_sha256: result.manifest.collector.sha256,
    evidence_collected: false,
    production_contact_performed: false,
    production_mutation_performed: false
  }, null, 2));
}

export function createReceiptCommand(args) {
  const evidenceDir = requiredExternalPath(args.evidence ?? args["evidence-dir"], "evidence");
  const output = requiredExternalPath(args.output, "output");
  assert(!existsSync(output), "output receipt must not already exist");
  const receipt = createReceiptFromEvidenceBundle(evidenceDir);
  validateReceipt(receipt, { requireOperationalBaseline: args["require-operational-baseline"] === "true" });
  mkdirSync(path.dirname(output), { recursive: true });
  writeJson(output, receipt, 0o600);
  console.log(JSON.stringify({
    status: "production-operational-evidence-receipt-created",
    receipt: output,
    sha256: sha256(readFileSync(output)),
    operational_baseline: receipt.operational_baseline
  }, null, 2));
}

export function verifyReceiptCommand(args) {
  const receiptFile = requiredExternalPath(args.receipt ?? args.input, "receipt");
  const receipt = readJson(receiptFile);
  validateReceipt(receipt, { requireOperationalBaseline: args["require-operational-baseline"] === "true" });
  console.log(JSON.stringify({
    status: "production-operational-evidence-receipt-verified",
    receipt: receiptFile,
    sha256: sha256(readFileSync(receiptFile)),
    operational_baseline: receipt.operational_baseline,
    production_mutation_performed: false,
    deployment_performed: false,
    backup_performed: false,
    restore_performed: false
  }, null, 2));
}

export function verifyHandoffBundle(bundle) {
  const root = requiredExternalPath(bundle, "bundle");
  assert(existsSync(root) && statSync(root).isDirectory(), "bundle must be an existing directory");
  assertExactFiles(root, HANDOFF_FILES);
  const checksumMap = verifyChecksums(root, HANDOFF_CHECKSUM_FILES);
  const manifest = readJson(path.join(root, "manifest.json"));
  const contract = readJson(path.join(root, "evidence-contract.json"));
  const collector = readText(path.join(root, COLLECTOR_BUNDLE_FILE));

  validateHandoffManifest(manifest, checksumMap, root);
  validateEvidenceContract(contract, manifest);
  scanTextForSecrets(readText(path.join(root, "README.md")), "README.md");
  scanTextForSecrets(JSON.stringify(contract), "evidence-contract.json");
  scanTextForSecrets(JSON.stringify(manifest), "manifest.json");
  scanTextForSecrets(collector, COLLECTOR_BUNDLE_FILE);
  assert(!collector.includes("\r"), `${COLLECTOR_BUNDLE_FILE} must use LF line endings`);
  scanCollectorForForbiddenCommands(collector);

  return { ok: true, files: HANDOFF_FILES, manifest };
}

export function createReceiptFromEvidenceBundle(evidenceDir) {
  const root = requiredExternalPath(evidenceDir, "evidence");
  assert(existsSync(root) && statSync(root).isDirectory(), "evidence must be an existing directory");
  assertExactFiles(root, EVIDENCE_FILES);
  verifyChecksums(root, ["collector-metadata.txt", "evidence-records.tsv"]);
  scanTextForSecrets(readText(path.join(root, "collector-metadata.txt")), "collector-metadata.txt");
  scanTextForSecrets(readText(path.join(root, "evidence-records.tsv")), "evidence-records.tsv");

  const receipt = createReceiptSkeleton();
  const records = parseEvidenceRecords(readText(path.join(root, "evidence-records.tsv")));
  for (const [key, value] of records) {
    setPath(receipt, key, parseRecordValue(value));
  }
  deriveReceiptFields(receipt);
  return receipt;
}

export function validateReceipt(receipt, options = {}) {
  scanValueForSecrets(receipt, "receipt");
  validateReceiptShape(receipt);
  validateReceiptStaticFields(receipt);
  validateReceiptFlags(receipt);
  validateIdentity(receipt.identity);
  validateServices(receipt.services);
  validateMigration(receipt.migration);
  validateWorkerScheduler(receipt.worker_scheduler);
  validateHealthBoundary(receipt.health_boundary);
  validateTls(receipt.tls);
  validatePointers(receipt.pointers);
  validateStability(receipt.stability);
  validateOutsideScope(receipt.outside_scope);

  const baseline = computeOperationalBaseline(receipt);
  assert(receipt.operational_baseline === baseline, `operational_baseline must be ${baseline}`);
  if (options.requireOperationalBaseline === true) {
    assert(baseline === "PASSED", "operational baseline is not passed");
  }
}

function renderHandoffReadme(generatedAt) {
  return `# Production Operational Evidence Handoff

This bundle prepares MS-019A read-only evidence collection for main-service production.

It is not production evidence. Generating or verifying this bundle does not contact production, mutate services, deploy, back up, restore, publish an artifact, create a Git tag or create a GitHub Release.

Operator flow:

1. Review evidence-contract.json.
2. Copy this bundle to the production host through an operator-approved channel.
3. Run the collector manually on the production host with a new empty output directory.
4. Bring the returned output directory back to the local workspace for the next milestone verifier.

Collector command shape:

\`\`\`sh
./collect-production-operational-evidence.sh --output-dir <external-output-dir>
\`\`\`

The collector records bounded key/value evidence only. It does not print environment contents, raw logs, request bodies, package archives, image archives, backups or private host details.

Generated at UTC: ${generatedAt}
`;
}

function createEvidenceContract() {
  return {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    milestone: "MS-019A",
    service: RELEASE_IDENTITY.application,
    environment: "production",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    canonical_remote: CANONICAL_REMOTE,
    expected_public_base_url: EXPECTED_PUBLIC_BASE_URL,
    expected_loopback_base_url: EXPECTED_LOOPBACK_BASE_URL,
    expected_services: [...EXPECTED_SERVICES],
    expected_public_routes: [...EXPECTED_PUBLIC_ROUTES],
    expected_migrations: [...EXPECTED_MIGRATIONS],
    expected_worker: {
      queue: "main-service.maintenance",
      scheduler: "cleanup.daily",
      job: "cleanup.run.v1",
      timezone: "UTC",
      global_concurrency: 1,
      local_concurrency: 1
    },
    status_vocabulary: [...STATUS_VALUES].sort(),
    receipt_file: RECEIPT_FILE,
    collected_bundle_files: [...EVIDENCE_FILES],
    read_only_boundary: {
      production_evidence_collected_by_handoff_generation: false,
      production_contact_performed_by_handoff_generation: false,
      production_mutation_performed: false,
      runtime_code_change_required: false,
      backup_restore_in_scope: false,
      publication_in_scope: false
    },
    receipt_modes: {
      schema_valid_partial_is_allowed: true,
      require_operational_baseline_rejects_partial: true
    }
  };
}

function createHandoffManifest(outputDir, generatedAt, generationSourceCommit, collectorSha) {
  return {
    schema_version: 1,
    bundle_type: "production-operational-evidence-handoff",
    milestone: "MS-019A",
    service: RELEASE_IDENTITY.application,
    environment: "production",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    canonical_remote: CANONICAL_REMOTE,
    expected_public_base_url: EXPECTED_PUBLIC_BASE_URL,
    expected_service_inventory: [...EXPECTED_SERVICES],
    expected_health_routes: [
      "GET http://127.0.0.1:3200/health/live",
      "GET http://127.0.0.1:3200/health/ready",
      "GET https://rss.habersoft.com/health/live",
      "GET https://rss.habersoft.com/health/ready",
      "GET https://rss.habersoft.com/not-found",
      "GET https://rss.habersoft.com/api/feeds",
      "GET https://rss.habersoft.com/agent/feeds/due?limit=1",
      "GET http://rss.habersoft.com/health/live"
    ],
    generated_by: "scripts/production-operational-evidence.mjs",
    generated_at_utc: generatedAt,
    generation_source_commit: generationSourceCommit,
    collector: {
      filename: COLLECTOR_BUNDLE_FILE,
      sha256: collectorSha,
      executable_intended: true
    },
    payload_files: HANDOFF_PAYLOAD_FILES.map((file) => fileMetadata(outputDir, file)),
    safety_flags: Object.fromEntries(SAFETY_FLAG_KEYS.map((key) => [key, false])),
    evidence_collected: false,
    production_contact_performed: false,
    secrets_included: false,
    production_mutation_performed: false,
    deployment_performed: false,
    backup_performed: false,
    restore_performed: false,
    artifact_published: false,
    git_tag_created: false,
    github_release_created: false
  };
}

function validateHandoffManifest(manifest, checksumMap, root) {
  assertExactKeys(manifest, [
    "schema_version",
    "bundle_type",
    "milestone",
    "service",
    "environment",
    "application_version",
    "application_status",
    "canonical_remote",
    "expected_public_base_url",
    "expected_service_inventory",
    "expected_health_routes",
    "generated_by",
    "generated_at_utc",
    "generation_source_commit",
    "collector",
    "payload_files",
    "safety_flags",
    "evidence_collected",
    "production_contact_performed",
    "secrets_included",
    "production_mutation_performed",
    "deployment_performed",
    "backup_performed",
    "restore_performed",
    "artifact_published",
    "git_tag_created",
    "github_release_created"
  ], "manifest");
  assert(manifest.schema_version === 1, "manifest schema_version must be 1");
  assert(manifest.bundle_type === "production-operational-evidence-handoff", "manifest bundle_type mismatch");
  assert(manifest.milestone === "MS-019A", "manifest milestone mismatch");
  assert(manifest.service === RELEASE_IDENTITY.application, "manifest service mismatch");
  assert(manifest.environment === "production", "manifest environment mismatch");
  assert(manifest.application_version === RELEASE_IDENTITY.version, "manifest application_version mismatch");
  assert(manifest.application_status === RELEASE_IDENTITY.status, "manifest application_status mismatch");
  assert(manifest.canonical_remote === CANONICAL_REMOTE, "manifest canonical_remote mismatch");
  assert(manifest.expected_public_base_url === EXPECTED_PUBLIC_BASE_URL, "manifest public base URL mismatch");
  assertSameArray(manifest.expected_service_inventory, [...EXPECTED_SERVICES], "manifest service inventory mismatch");
  assert(isIsoDateTime(manifest.generated_at_utc), "manifest generated_at_utc must be ISO");
  assert(isGitSha(manifest.generation_source_commit), "manifest generation_source_commit must be 40-hex");
  assert(manifest.generated_by === "scripts/production-operational-evidence.mjs", "manifest generated_by mismatch");
  assert(manifest.collector?.filename === COLLECTOR_BUNDLE_FILE, "manifest collector filename mismatch");
  assert(manifest.collector.sha256 === checksumMap.get(COLLECTOR_BUNDLE_FILE), "manifest collector checksum mismatch");
  assert(manifest.collector.executable_intended === true, "manifest collector executable flag mismatch");
  if (process.platform !== "win32") {
    assert((statSync(path.join(root, COLLECTOR_BUNDLE_FILE)).mode & 0o111) !== 0, "collector must be executable");
  }

  const payloadPaths = (manifest.payload_files ?? []).map((file) => file.path).sort();
  assertSameArray(payloadPaths, [...HANDOFF_PAYLOAD_FILES].sort(), "manifest payload file inventory mismatch");
  for (const file of manifest.payload_files ?? []) {
    assert(HANDOFF_PAYLOAD_FILES.includes(file.path), `unexpected manifest payload ${file.path}`);
    assert(file.sha256 === checksumMap.get(file.path), `manifest payload hash mismatch for ${file.path}`);
    assert(file.bytes === statSync(path.join(root, file.path)).size, `manifest payload size mismatch for ${file.path}`);
  }

  assertSameArray(Object.keys(manifest.safety_flags ?? {}).sort(), [...SAFETY_FLAG_KEYS].sort(), "manifest safety flag keys mismatch");
  for (const key of SAFETY_FLAG_KEYS) {
    assert(manifest.safety_flags[key] === false, `manifest safety flag ${key} must be false`);
    assert(manifest[key] === false, `manifest top-level flag ${key} must be false`);
  }
}

function validateEvidenceContract(contract, manifest) {
  assert(contract.schema_version === 1, "contract schema_version must be 1");
  assert(contract.contract_version === CONTRACT_VERSION, "contract version mismatch");
  assert(contract.milestone === "MS-019A", "contract milestone mismatch");
  assert(contract.service === RELEASE_IDENTITY.application, "contract service mismatch");
  assert(contract.environment === "production", "contract environment mismatch");
  assert(contract.application_version === RELEASE_IDENTITY.version, "contract version mismatch");
  assert(contract.application_status === RELEASE_IDENTITY.status, "contract status mismatch");
  assert(contract.canonical_remote === CANONICAL_REMOTE, "contract canonical_remote mismatch");
  assertSameArray(contract.expected_services, [...EXPECTED_SERVICES], "contract expected service mismatch");
  assertSameArray(contract.expected_migrations, [...EXPECTED_MIGRATIONS], "contract expected migrations mismatch");
  assert(contract.expected_public_base_url === manifest.expected_public_base_url, "contract public base mismatch");
  assert(contract.expected_worker?.queue === "main-service.maintenance", "contract worker queue mismatch");
  assert(contract.expected_worker?.scheduler === "cleanup.daily", "contract scheduler mismatch");
  assert(contract.expected_worker?.job === "cleanup.run.v1", "contract worker job mismatch");
  assert(contract.expected_worker?.timezone === "UTC", "contract worker timezone mismatch");
  assert(contract.expected_worker?.global_concurrency === 1, "contract global concurrency mismatch");
  assert(contract.expected_worker?.local_concurrency === 1, "contract local concurrency mismatch");
  assert(contract.read_only_boundary?.production_evidence_collected_by_handoff_generation === false, "contract must not claim evidence collection");
  assert(contract.read_only_boundary?.production_contact_performed_by_handoff_generation === false, "contract must not claim production contact");
  assert(contract.read_only_boundary?.production_mutation_performed === false, "contract must not claim production mutation");
}

function createReceiptSkeleton() {
  return {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    milestone: "MS-019A",
    service: RELEASE_IDENTITY.application,
    environment: "production",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    collected_at_utc: "NOT_RECORDED",
    collector_source_commit: "NOT_RECORDED",
    collector_sha256: "NOT_RECORDED",
    evidence_mode: "READ_ONLY",
    production_mutation_performed: false,
    deployment_performed: false,
    backup_performed: false,
    restore_performed: false,
    artifact_published: false,
    git_tag_created: false,
    github_release_created: false,
    operational_baseline: "PARTIAL",
    identity: {
      canonical_remote: CANONICAL_REMOTE,
      server_checkout_commit: "NOT_RECORDED",
      server_checkout_clean: "NOT_RECORDED",
      local_origin_main_ref: "NOT_RECORDED",
      runtime_image_env_image_id: "NOT_RECORDED",
      api_running_image_id: "NOT_RECORDED",
      worker_running_image_id: "NOT_RECORDED",
      inspected_image_id: "NOT_RECORDED",
      running_image_revision_label: "NOT_RECORDED",
      running_image_source_label: "NOT_RECORDED",
      image_identity_consistent: false,
      server_checkout_matches_running_revision: false,
      runtime_revision_known_in_canonical_repo: false,
      runtime_revision_ancestor_of_verified_origin_main: false
    },
    services: {
      expected_services: [...EXPECTED_SERVICES],
      observed_service_states: {},
      unexpected_services: [],
      api_loopback_binding: {
        result: "NOT_RECORDED",
        host_ip: "NOT_RECORDED",
        host_port: "NOT_RECORDED",
        container_port: 3000
      },
      public_database_port_absent: "NOT_RECORDED",
      public_redis_port_absent: "NOT_RECORDED",
      worker_host_port_absent: "NOT_RECORDED"
    },
    migration: {
      result: "NOT_RECORDED",
      evidence_source: "NOT_RECORDED",
      expected_migrations: [...EXPECTED_MIGRATIONS],
      pending_or_failed: "NOT_RECORDED",
      output_sha256: "NOT_RECORDED"
    },
    worker_scheduler: {
      worker_health: "NOT_RECORDED",
      worker_health_evidence_source: "NOT_RECORDED",
      queue: "main-service.maintenance",
      scheduler: "cleanup.daily",
      job: "cleanup.run.v1",
      timezone: "UTC",
      global_concurrency: 1,
      local_concurrency: 1,
      scheduler_evidence_source: "NOT_RECORDED"
    },
    health_boundary: {
      internal_live: endpointSkeleton("http://127.0.0.1:3200/health/live", 200),
      internal_ready: endpointSkeleton("http://127.0.0.1:3200/health/ready", 200),
      public_live: endpointSkeleton("https://rss.habersoft.com/health/live", 200),
      public_ready: endpointSkeleton("https://rss.habersoft.com/health/ready", 200),
      postgres: "NOT_RECORDED",
      redis: "NOT_RECORDED",
      tenantAuth: "NOT_RECORDED",
      unknown_route: endpointSkeleton("https://rss.habersoft.com/not-found", 404),
      tenant_unauth: endpointSkeleton("https://rss.habersoft.com/api/feeds", 401),
      agent_unauth: endpointSkeleton("https://rss.habersoft.com/agent/feeds/due?limit=1", 401),
      http_to_https_redirect: {
        result: "NOT_RECORDED",
        source_url: "http://rss.habersoft.com/health/live",
        location: "NOT_RECORDED"
      }
    },
    tls: {
      verification: "NOT_RECORDED",
      fingerprint_sha256: "NOT_RECORDED",
      not_before: "NOT_RECORDED",
      not_after: "NOT_RECORDED",
      hostname_match: "NOT_RECORDED",
      tool_availability: "NOT_RECORDED"
    },
    pointers: {
      current_image_identity: "NOT_RECORDED",
      previous_commit: "NOT_RECORDED",
      previous_image_id: "NOT_RECORDED"
    },
    stability: {
      observation_kind: "POINT_IN_TIME_SNAPSHOT",
      api: containerSnapshotSkeleton(),
      worker: containerSnapshotSkeleton(),
      error_burst: "NOT_RECORDED"
    },
    outside_scope: {
      production_backup_sha256: "NOT_RECORDED",
      production_off_host_restore: "NOT_RECORDED",
      edge_body_limit: "NOT_RECORDED",
      long_term_stability: "NOT_RECORDED",
      artifact_publication: "NOT_PERFORMED",
      registry_publication: "NOT_PERFORMED",
      git_tag: "NOT_CREATED",
      github_release: "NOT_CREATED"
    }
  };
}

function endpointSkeleton(url, expectedStatus) {
  return {
    result: "NOT_RECORDED",
    method: "GET",
    url,
    http_status: "NOT_RECORDED",
    expected_http_status: expectedStatus,
    response_status: "NOT_RECORDED"
  };
}

function containerSnapshotSkeleton() {
  return {
    restart_count: "NOT_RECORDED",
    oom_killed: "NOT_RECORDED",
    state: "NOT_RECORDED",
    started_at: "NOT_RECORDED"
  };
}

function deriveReceiptFields(receipt) {
  const identity = receipt.identity;
  const imageIds = [
    identity.runtime_image_env_image_id,
    identity.api_running_image_id,
    identity.worker_running_image_id,
    identity.inspected_image_id
  ];
  identity.image_identity_consistent = imageIds.every((image) => isDockerImageId(image)) && new Set(imageIds).size === 1;
  identity.server_checkout_matches_running_revision =
    isGitSha(identity.server_checkout_commit) &&
    isGitSha(identity.running_image_revision_label) &&
    identity.server_checkout_commit === identity.running_image_revision_label;
  receipt.operational_baseline = computeOperationalBaseline(receipt);
}

function validateReceiptShape(receipt) {
  assertExactKeys(receipt, [
    "schema_version",
    "contract_version",
    "milestone",
    "service",
    "environment",
    "application_version",
    "application_status",
    "collected_at_utc",
    "collector_source_commit",
    "collector_sha256",
    "evidence_mode",
    "production_mutation_performed",
    "deployment_performed",
    "backup_performed",
    "restore_performed",
    "artifact_published",
    "git_tag_created",
    "github_release_created",
    "operational_baseline",
    "identity",
    "services",
    "migration",
    "worker_scheduler",
    "health_boundary",
    "tls",
    "pointers",
    "stability",
    "outside_scope"
  ], "receipt");
}

function validateReceiptStaticFields(receipt) {
  assert(receipt.schema_version === 1, "receipt schema_version must be 1");
  assert(receipt.contract_version === CONTRACT_VERSION, "receipt contract_version mismatch");
  assert(receipt.milestone === "MS-019A", "receipt milestone mismatch");
  assert(receipt.service === RELEASE_IDENTITY.application, "receipt service mismatch");
  assert(receipt.environment === "production", "receipt environment mismatch");
  assert(receipt.application_version === RELEASE_IDENTITY.version, "receipt application_version mismatch");
  assert(receipt.application_status === RELEASE_IDENTITY.status, "receipt application_status mismatch");
  assert(receipt.evidence_mode === "READ_ONLY", "receipt evidence_mode must be READ_ONLY");
  assert(isIsoDateTime(receipt.collected_at_utc) || receipt.collected_at_utc === "NOT_RECORDED", "receipt collected_at_utc invalid");
  assert(isGitSha(receipt.collector_source_commit) || receipt.collector_source_commit === "NOT_RECORDED", "collector_source_commit invalid");
  assert(isSha256(receipt.collector_sha256) || receipt.collector_sha256 === "NOT_RECORDED", "collector_sha256 invalid");
  assert(["PASSED", "PARTIAL"].includes(receipt.operational_baseline), "operational_baseline invalid");
}

function validateReceiptFlags(receipt) {
  for (const key of [
    "production_mutation_performed",
    "deployment_performed",
    "backup_performed",
    "restore_performed",
    "artifact_published",
    "git_tag_created",
    "github_release_created"
  ]) {
    assert(receipt[key] === false, `${key} must be false`);
  }
}

function validateIdentity(identity) {
  assertExactKeys(identity, [
    "canonical_remote",
    "server_checkout_commit",
    "server_checkout_clean",
    "local_origin_main_ref",
    "runtime_image_env_image_id",
    "api_running_image_id",
    "worker_running_image_id",
    "inspected_image_id",
    "running_image_revision_label",
    "running_image_source_label",
    "image_identity_consistent",
    "server_checkout_matches_running_revision",
    "runtime_revision_known_in_canonical_repo",
    "runtime_revision_ancestor_of_verified_origin_main"
  ], "identity");
  assert(identity.canonical_remote === CANONICAL_REMOTE, "identity canonical_remote mismatch");
  assert(isGitSha(identity.server_checkout_commit) || identity.server_checkout_commit === "NOT_RECORDED", "server_checkout_commit malformed");
  assert(typeof identity.server_checkout_clean === "boolean" || identity.server_checkout_clean === "NOT_RECORDED", "server_checkout_clean invalid");
  assert(isGitSha(identity.local_origin_main_ref) || identity.local_origin_main_ref === "NOT_RECORDED", "local_origin_main_ref malformed");

  for (const field of [
    "runtime_image_env_image_id",
    "api_running_image_id",
    "worker_running_image_id",
    "inspected_image_id"
  ]) {
    assert(isDockerImageId(identity[field]) || identity[field] === "NOT_RECORDED", `${field} malformed`);
  }

  const allImageIds = [
    identity.runtime_image_env_image_id,
    identity.api_running_image_id,
    identity.worker_running_image_id,
    identity.inspected_image_id
  ];
  if (allImageIds.every(isDockerImageId)) {
    assert(new Set(allImageIds).size === 1, "runtime/API/worker/inspected image mismatch");
    assert(identity.image_identity_consistent === true, "image_identity_consistent must be true");
  } else {
    assert(identity.image_identity_consistent === false, "image_identity_consistent must be false when image evidence is partial");
  }

  if (identity.running_image_revision_label !== "NOT_RECORDED") {
    assert(isGitSha(identity.running_image_revision_label), "running_image_revision_label malformed");
    assert(identity.running_image_source_label === CANONICAL_REMOTE, "running_image_source_label wrong canonical remote");
    assert(identity.runtime_revision_known_in_canonical_repo === true, "runtime revision must be known in canonical repo");
    assert(gitStatus(["cat-file", "-e", `${identity.running_image_revision_label}^{commit}`]) === 0, "runtime revision not in canonical history");
    assert(identity.runtime_revision_ancestor_of_verified_origin_main === true, "runtime revision must be ancestor of verified origin/main");
    assert(gitStatus(["merge-base", "--is-ancestor", identity.running_image_revision_label, "origin/main"]) === 0, "runtime revision is not ancestor of origin/main");
    const expectedMatch = identity.server_checkout_commit === identity.running_image_revision_label;
    assert(identity.server_checkout_matches_running_revision === expectedMatch, "server checkout/runtime equality boolean mismatch");
  } else {
    assert(identity.server_checkout_matches_running_revision === false, "server checkout/runtime equality must be false without revision label");
  }
}

function validateServices(services) {
  assertExactKeys(services, [
    "expected_services",
    "observed_service_states",
    "unexpected_services",
    "api_loopback_binding",
    "public_database_port_absent",
    "public_redis_port_absent",
    "worker_host_port_absent"
  ], "services");
  assertSameArray(services.expected_services, [...EXPECTED_SERVICES], "expected services mismatch");
  assert(Array.isArray(services.unexpected_services), "unexpected_services must be an array");
  assert(services.unexpected_services.length === 0, "unexpected production service observed");
  for (const service of EXPECTED_SERVICES) {
    assert(Object.hasOwn(services.observed_service_states, service), `missing expected service ${service}`);
  }

  const migrate = services.observed_service_states.migrate;
  assert(migrate.status !== "running", "migrate must not be long-running in steady state");
  const api = services.api_loopback_binding;
  assert(api.result === "PASSED", "API loopback binding must pass");
  assert(api.host_ip === "127.0.0.1", "API host binding must be loopback-only");
  assert(Number(api.container_port) === 3000, "API container port must be 3000");
  assert(Number(api.host_port) === 3200, "API host port must be 3200");
  assert(services.public_database_port_absent === "PASSED", "PostgreSQL host port must be absent");
  assert(services.public_redis_port_absent === "PASSED", "Redis host port must be absent");
  assert(services.worker_host_port_absent === "PASSED", "worker host port must be absent");
}

function validateMigration(migration) {
  assertSameArray(migration.expected_migrations, [...EXPECTED_MIGRATIONS], "migration expected inventory mismatch");
  assertStatus(migration.result, "migration.result");
  assertStatus(migration.evidence_source, "migration.evidence_source");
  assertStatus(migration.pending_or_failed, "migration.pending_or_failed");
  assert(isSha256(migration.output_sha256) || migration.output_sha256 === "NOT_RECORDED", "migration output_sha256 invalid");
  assert(migration.result !== "FAILED", "migration failed or pending");
  assert(migration.pending_or_failed !== "FAILED", "migration pending/failed classification");
}

function validateWorkerScheduler(worker) {
  assertStatus(worker.worker_health, "worker_health");
  assertStatus(worker.worker_health_evidence_source, "worker_health_evidence_source");
  assertStatus(worker.scheduler_evidence_source, "scheduler_evidence_source");
  assert(worker.worker_health !== "FAILED", "worker health failed");
  assert(worker.queue === "main-service.maintenance", "worker queue mismatch");
  assert(worker.scheduler === "cleanup.daily", "worker scheduler mismatch");
  assert(worker.job === "cleanup.run.v1", "worker job mismatch");
  assert(worker.timezone === "UTC", "worker timezone mismatch");
  assert(worker.global_concurrency === 1, "worker global concurrency mismatch");
  assert(worker.local_concurrency === 1, "worker local concurrency mismatch");
  if (worker.scheduler_evidence_source === "DIRECT_OBSERVED") {
    assert(worker.worker_health === "PASSED", "direct scheduler evidence requires worker health passed");
  }
}

function validateHealthBoundary(health) {
  assertEndpoint(health.internal_live, 200, "live", "internal_live");
  assertEndpoint(health.internal_ready, 200, "ready", "internal_ready");
  assertEndpoint(health.public_live, 200, "live", "public_live");
  assertEndpoint(health.public_ready, 200, "ready", "public_ready");
  assert(health.postgres === "up", "postgres readiness must be up");
  assert(health.redis === "up", "redis readiness must be up");
  assert(health.tenantAuth === "up", "tenantAuth readiness must be up");
  assertEndpoint(health.unknown_route, 404, undefined, "unknown_route");
  assertEndpoint(health.tenant_unauth, 401, undefined, "tenant_unauth");
  assertEndpoint(health.agent_unauth, 401, undefined, "agent_unauth");
  assert(health.unknown_route.http_status !== 200, "unknown route returned 2xx");
  assert(health.tenant_unauth.http_status !== 200, "tenant protected route returned 2xx");
  assert(health.agent_unauth.http_status !== 200, "agent protected route returned 2xx");
  assert(health.http_to_https_redirect?.result === "PASSED", "HTTP to HTTPS redirect failed");
  assert(health.http_to_https_redirect.location === "https://rss.habersoft.com/health/live", "HTTP redirect location mismatch");
}

function validateTls(tls) {
  assertStatus(tls.verification, "tls.verification");
  assertStatus(tls.tool_availability, "tls.tool_availability");
  assert(tls.verification !== "FAILED", "TLS verification failed");
  if (tls.verification === "PASSED") {
    assert(isSha256(tls.fingerprint_sha256), "TLS fingerprint invalid");
    assert(tls.hostname_match === true, "TLS hostname match failed");
    assert(typeof tls.not_before === "string" && tls.not_before !== "", "TLS not_before missing");
    assert(typeof tls.not_after === "string" && tls.not_after !== "", "TLS not_after missing");
  } else {
    assert(tls.verification === "TOOL_UNAVAILABLE" || tls.verification === "NOT_RECORDED", "TLS status invalid");
  }
}

function validatePointers(pointers) {
  assert(isDockerImageId(pointers.current_image_identity) || pointers.current_image_identity === "NOT_RECORDED", "current image pointer invalid");
  assert(isGitSha(pointers.previous_commit) || pointers.previous_commit === "NOT_RECORDED", "previous commit invalid");
  assert(isDockerImageId(pointers.previous_image_id) || pointers.previous_image_id === "NOT_RECORDED", "previous image invalid");
}

function validateStability(stability) {
  assert(stability.observation_kind === "POINT_IN_TIME_SNAPSHOT", "stability observation kind mismatch");
  for (const [name, snapshot] of Object.entries({ api: stability.api, worker: stability.worker })) {
    assert(Number.isInteger(snapshot.restart_count) && snapshot.restart_count >= 0, `${name} restart_count invalid`);
    assert(typeof snapshot.oom_killed === "boolean", `${name} oom_killed invalid`);
    assert(typeof snapshot.state === "string" && snapshot.state !== "", `${name} state invalid`);
    assert(isIsoDateTime(snapshot.started_at) || snapshot.started_at === "NOT_RECORDED", `${name} started_at invalid`);
  }
  assert(stability.error_burst === "NOT_RECORDED", "error burst must remain NOT_RECORDED");
}

function validateOutsideScope(scope) {
  assert(scope.production_backup_sha256 === "NOT_RECORDED", "backup SHA must remain NOT_RECORDED");
  assert(scope.production_off_host_restore === "NOT_RECORDED", "restore result must remain NOT_RECORDED");
  assert(scope.edge_body_limit === "NOT_RECORDED", "edge body-limit must remain NOT_RECORDED");
  assert(scope.long_term_stability === "NOT_RECORDED", "long-term stability must remain NOT_RECORDED");
  assert(scope.artifact_publication === "NOT_PERFORMED", "artifact publication must be NOT_PERFORMED");
  assert(scope.registry_publication === "NOT_PERFORMED", "registry publication must be NOT_PERFORMED");
  assert(scope.git_tag === "NOT_CREATED", "git tag must be NOT_CREATED");
  assert(scope.github_release === "NOT_CREATED", "GitHub Release must be NOT_CREATED");
}

function computeOperationalBaseline(receipt) {
  const partialReasons = [];
  const identity = receipt.identity;
  if (
    !identity.image_identity_consistent ||
    identity.running_image_revision_label === "NOT_RECORDED" ||
    identity.runtime_revision_known_in_canonical_repo !== true ||
    identity.runtime_revision_ancestor_of_verified_origin_main !== true
  ) {
    partialReasons.push("identity");
  }
  if (receipt.migration.result !== "PASSED") {
    partialReasons.push("migration");
  }
  if (receipt.worker_scheduler.worker_health !== "PASSED") {
    partialReasons.push("worker");
  }
  if (receipt.worker_scheduler.scheduler_evidence_source !== "DIRECT_OBSERVED") {
    partialReasons.push("scheduler");
  }
  if (receipt.tls.verification !== "PASSED") {
    partialReasons.push("tls");
  }
  if (receipt.pointers.previous_commit === "NOT_RECORDED" || receipt.pointers.previous_image_id === "NOT_RECORDED") {
    partialReasons.push("previous pointer");
  }
  return partialReasons.length === 0 ? "PASSED" : "PARTIAL";
}

function assertEndpoint(endpoint, expectedStatus, expectedResponseStatus, name) {
  assert(endpoint.method === "GET", `${name} method must be GET`);
  assert(endpoint.result === "PASSED", `${name} must pass`);
  assert(endpoint.http_status === expectedStatus, `${name} HTTP status mismatch`);
  assert(endpoint.expected_http_status === expectedStatus, `${name} expected HTTP status mismatch`);
  if (expectedResponseStatus !== undefined) {
    assert(endpoint.response_status === expectedResponseStatus, `${name} response status mismatch`);
  }
}

function scanCollectorForForbiddenCommands(text) {
  const forbiddenPatterns = [
    /\b(?:ssh|scp|rsync|sftp)\b/u,
    /\bsudo\b/u,
    /\b(?:apt|apt-get|yum)\b/u,
    /\bgit\s+(?:fetch|pull|switch|checkout|reset|clean)\b/u,
    /\bdocker\s+build\b/u,
    /\bdocker\s+(?:pull|load|push|logs)\b/u,
    /\bdocker\s+compose\s+(?:up|down|restart|stop|rm|run|create)\b/u,
    /\bjournalctl\b/u,
    /(^|[;&|()`]\s*)env(\s|$)/mu,
    /\bprintenv\b/u,
    /\.Config\.Env/u,
    /\{\{\s*json\s+\./u,
    /\bHostConfig\b/u,
    /\bMounts\b/u,
    /\bdocker\s+inspect(?![^\n]*--format)/u,
    /\bprisma\s+db\s+push\b/u,
    /\bredis-cli\b/u,
    /\b(?:POST|PUT|PATCH|DELETE)\b/u,
    /\b--insecure\b|\b-k\b/u,
    /\bdocker\s+(?:system|volume)\s+prune\b/u
  ];
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(text), `collector contains forbidden command pattern ${pattern}`);
  }
  assert(!/\bset\s+-x\b/u.test(text), "collector must not use set -x");
  assert(!/cat\s+["']?\$?\{?[^ \n]*ENV[^ \n]*\}?/iu.test(text), "collector must not dump environment files");
}

function scanTextForSecrets(text, label) {
  const patterns = [
    /DATABASE_URL\s*=/iu,
    /POSTGRES_PASSWORD\s*=/iu,
    /AGENT_KEY\s*=/iu,
    /TENANT_RATE_LIMIT_KEY_SECRET\s*=/iu,
    /Authorization\s*:/iu,
    /Bearer\s+[A-Za-z0-9._-]+/u,
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
    /Cookie\s*:/iu,
    /password\s*[:=]\s*[^<\s"']{8,}/iu,
    /credential\s*[:=]\s*[^<\s"']{8,}/iu,
    /secret\s*[:=]\s*[^<\s"']{8,}/iu,
    /\.Config\.Env/u,
    /known_hosts/iu,
    /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/iu,
    /(?:^|[\s`"'(<])(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp)\/)/u,
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/u,
    /-----BEGIN CERTIFICATE-----/u,
    /\braw_log\b|\braw_body\b|\brequest_payload\b/iu,
    /\bmain-service-image\.tar\b|\bbackup\.dump\b/iu
  ];
  for (const pattern of patterns) {
    assert(!pattern.test(text), `secret/privacy pattern in ${label}: ${pattern}`);
  }
}

function scanValueForSecrets(value, trail) {
  if (typeof value === "string") {
    scanTextForSecrets(value, trail);
    assert(!/[A-Za-z]:\\Users\\[^\\]+/u.test(value), `private operator path at ${trail}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValueForSecrets(entry, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assert(!/^(?:DATABASE_URL|POSTGRES_PASSWORD|AGENT_KEY|TENANT_RATE_LIMIT_KEY_SECRET)$/iu.test(key), `forbidden secret key at ${trail}.${key}`);
      assert(!/(authorization|cookie|credential|private_key|database_url|agent_key)$/iu.test(key), `forbidden field ${trail}.${key}`);
      scanValueForSecrets(nested, `${trail}.${key}`);
    }
  }
}

function parseEvidenceRecords(text) {
  const records = [];
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    if (rawLine.trim() === "") {
      continue;
    }
    const parts = rawLine.split("\t");
    assert(parts.length === 2, `malformed evidence record line ${index + 1}`);
    const [key, value] = parts;
    assert(/^[a-zA-Z0-9_.-]+$/u.test(key), `invalid evidence record key ${key}`);
    assert(!key.includes(".."), `path traversal evidence key ${key}`);
    records.push([key, value]);
  }
  return records;
}

function parseRecordValue(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/u.test(value)) {
    return Number(value);
  }
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    return JSON.parse(value);
  }
  return value;
}

function setPath(target, key, value) {
  const parts = key.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!Object.hasOwn(cursor, part) || typeof cursor[part] !== "object" || cursor[part] === null) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function prepareEmptyOutputDir(outputDir) {
  assert(!isInsideRepo(outputDir), "output must be outside the application repository");
  if (existsSync(outputDir)) {
    assert(statSync(outputDir).isDirectory(), "output must be a directory");
    assert(readdirSync(outputDir).length === 0, "output directory must be empty");
  } else {
    mkdirSync(outputDir, { recursive: true });
  }
}

function assertExactFiles(root, expectedFiles) {
  const entries = readdirSync(root, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const stat = lstatSync(absolute);
    assert(!stat.isSymbolicLink(), `bundle entry must not be a symlink: ${entry.name}`);
    assert(entry.isFile(), `bundle entry must be a file: ${entry.name}`);
    names.push(entry.name);
  }
  assertSameArray(names.sort(), [...expectedFiles].sort(), "file inventory mismatch");
}

function verifyChecksums(root, expectedFiles) {
  const text = readText(path.join(root, "checksums.sha256")).trim();
  assert(text !== "", "checksums.sha256 must not be empty");
  const checksumMap = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
    assert(match !== null, `malformed checksum line: ${line}`);
    const [, expected, relative] = match;
    assert(expectedFiles.includes(relative), `unexpected checksum path ${relative}`);
    assert(!relative.includes("..") && !path.isAbsolute(relative), `unsafe checksum path ${relative}`);
    assert(!checksumMap.has(relative), `duplicate checksum for ${relative}`);
    const absolute = path.join(root, relative);
    assert(existsSync(absolute), `checksum file missing ${relative}`);
    const actual = sha256(readFileSync(absolute));
    assert(actual === expected, `checksum mismatch for ${relative}`);
    checksumMap.set(relative, expected);
  }
  assertSameArray([...checksumMap.keys()].sort(), [...expectedFiles].sort(), "checksum inventory mismatch");
  return checksumMap;
}

function writeChecksums(root, files) {
  const lines = files.map((file) => `${sha256(readFileSync(path.join(root, file)))}  ${file}`);
  writeText(path.join(root, "checksums.sha256"), `${lines.join("\n")}\n`, 0o644);
}

function fileMetadata(root, file) {
  const absolute = path.join(root, file);
  return {
    path: file,
    sha256: sha256(readFileSync(absolute)),
    bytes: statSync(absolute).size
  };
}

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  assertSameArray(actual, [...keys].sort(), `${label} field inventory mismatch`);
}

function assertStatus(value, label) {
  assert(STATUS_VALUES.has(value), `${label} has unsupported status ${value}`);
}

function assertSameArray(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function isGitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isDockerImageId(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isIsoDateTime(value) {
  return typeof value === "string" && value.endsWith("Z") && !Number.isNaN(Date.parse(value));
}

function requiredExternalPath(value, name) {
  assert(typeof value === "string" && value.trim() !== "", `${name} is required`);
  const resolved = path.resolve(value);
  assert(!isInsideRepo(resolved), `${name} must be outside the application repository`);
  return resolved;
}

function isInsideRepo(file) {
  const relative = path.relative(repoRoot, path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false });
  assert(result.status === 0, `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function gitStatus(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false }).status ?? 1;
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function readText(file) {
  return readFileSync(path.resolve(file), "utf8");
}

function writeJson(file, value, mode) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function writeText(file, value, mode) {
  writeFileSync(file, value, { mode });
  if (process.platform !== "win32") {
    chmodSync(file, mode);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error(`${SCRIPT_NAME}: ${message}`);
  process.exit(1);
}
