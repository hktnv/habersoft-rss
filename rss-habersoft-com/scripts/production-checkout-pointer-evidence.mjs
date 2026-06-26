#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACT_VERSION = 'production-checkout-pointer-evidence-v1';
const RECEIPT_SCHEMA_VERSION = 'production-checkout-pointer-receipt-v1';
const MILESTONE = 'MS-019D';
const RECEIPT_MILESTONE = 'MS-019D-R1';
const SERVICE_NAME = 'main-service';
const CANONICAL_REMOTE = 'https://github.com/hktnv/habersoft-rss';
const DEFAULT_PREVIOUS_STATE_SCHEMA = 'production-release-pointer-state-v1';
const AUTHORITY_SCHEMA_VERSION = 'production-checkout-pointer-returned-authority-v1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.dirname(REPO_ROOT);
const DEFAULT_HANDOFF_DIR = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019d',
  'production-checkout-pointer-handoff-v1',
);
const DEFAULT_FREEZE_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019d',
  'verification',
  'handoff-v1-freeze.json',
);
const DEFAULT_RECEIPT_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019d',
  'production-checkout-pointer-receipt.json',
);
const DEFAULT_AUTHORITY_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019d',
  'verification',
  'production-checkout-pointer-returned-v1-authority.json',
);
const DEFAULT_POINTER_STATE_FILE = path.join(
  WORKSPACE_ROOT,
  'operator-state',
  'ms-019d',
  'production-release-pointer-state.json',
);

const SOURCE_COLLECTOR = path.join(REPO_ROOT, 'scripts', 'production-checkout-pointer-collector.sh');
const HANDOFF_COLLECTOR = 'collect-production-checkout-pointer-evidence.sh';
const HANDOFF_FILES = [
  'README.md',
  HANDOFF_COLLECTOR,
  'checkout-pointer-contract.json',
  'manifest.json',
  'checksums.sha256',
];
const EVIDENCE_FILES = ['collector-metadata.txt', 'evidence-records.tsv', 'checksums.sha256'];
const SUCCESS_CHECKOUT_CLASSES = new Set(['CLEAN', 'ALLOWLISTED_EXTERNAL_STATE_IGNORED']);
const CHECKOUT_CLASSIFICATIONS = new Set([
  'CLEAN',
  'ALLOWLISTED_EXTERNAL_STATE_IGNORED',
  'ALLOWLISTED_EXTERNAL_STATE_UNTRACKED',
  'UNTRACKED_UNKNOWN',
  'TRACKED_INDEX_MODIFIED',
  'TRACKED_WORKTREE_MODIFIED',
  'TRACKED_DELETED',
  'UNMERGED_CONFLICTS',
  'GIT_OPERATION_IN_PROGRESS',
  'DETACHED_HEAD',
  'WRONG_BRANCH',
]);
const PREVIOUS_POINTER_RESULTS = new Set(['VERIFIED', 'PREVIOUS_POINTER_NOT_RECORDED', 'BLOCKED']);
const BLOCKED_OUTCOMES = new Set(['SUCCESS', 'PARTIAL_ACCEPTED', 'BLOCKED']);
const EXPECTED_METADATA_KEYS = new Set([
  'collector',
  'milestone',
  'service',
  'contract_version',
  'canonical_remote',
  'source_commit',
  'generated_utc',
  'read_only',
  'production_mutation',
]);
const EXPECTED_RECORD_KEYS = new Set([
  'bundle.milestone',
  'bundle.service',
  'bundle.contract_version',
  'bundle.collector_source_commit',
  'git.remote_url',
  'git.canonical_remote_expected',
  'git.head_commit',
  'git.origin_main_commit',
  'git.branch_name',
  'git.head_is_origin_main',
  'git.head_reachable_from_origin_main',
  'git.is_shallow_repository',
  'git.merge_in_progress',
  'git.cherry_pick_in_progress',
  'git.revert_in_progress',
  'git.rebase_apply_in_progress',
  'git.rebase_merge_in_progress',
  'checkout.tracked_index_change_count',
  'checkout.tracked_worktree_change_count',
  'checkout.tracked_deletion_count',
  'checkout.unmerged_count',
  'checkout.unknown_untracked_count',
  'checkout.unknown_untracked_path_hashes',
  'checkout.allowlisted_external_state_untracked_count',
  'checkout.operator_state_ignore_policy_present',
  'checkout.deploy_runtime_image_ignore_policy_present',
  'checkout.env_production_ignore_policy_present',
  'checkout.overbroad_source_ignore_detected',
  'checkout.classification',
  'runtime.image_env_parse_status',
  'runtime.main_service_image',
  'runtime.api_container_present',
  'runtime.worker_container_present',
  'compose.config_services_status',
  'current_pointer.api_image_id',
  'current_pointer.worker_image_id',
  'current_pointer.runtime_image_id',
  'current_pointer.image_revision',
  'current_pointer.image_source',
  'current_pointer.api_worker_image_match',
  'current_pointer.runtime_image_matches_api',
  'current_pointer.revision_exists_in_checkout',
  'current_pointer.revision_reachable_from_origin_main',
  'current_pointer.revision_matches_checkout_head',
  'previous_pointer.source_status',
  'previous_pointer.commit',
  'previous_pointer.image_id',
  'previous_pointer.image_revision',
  'previous_pointer.image_source',
  'previous_pointer.commit_exists_in_checkout',
  'previous_pointer.commit_reachable_from_origin_main',
  'previous_pointer.image_revision_matches_commit',
  'previous_pointer.image_differs_from_current',
  'previous_pointer.verification_result',
]);

const SECRET_PATTERNS = [
  /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY|API_KEY)[A-Z0-9_]*\s*=\s*[^ \n\r\t]+/i,
  /\bDATABASE_URL\b/i,
  /\b(?:Authorization|Bearer)\b/i,
  /\b(?:AGENT_KEY|TENANT_RATE_LIMIT_KEY_SECRET)\b/i,
  /"Env"\s*:/i,
  /\bdiff --git\b/i,
  /\b(?:BEGIN|END) OPENSSH PRIVATE KEY\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function toNativePath(filePath) {
  if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) {
    return filePath.slice(1);
  }
  return filePath;
}

function fail(message) {
  throw new Error(message);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function ensureEmptyOutputDir(dir) {
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) {
      fail(`Output path exists and is not a directory: ${dir}`);
    }
    const entries = fs.readdirSync(dir);
    if (entries.length > 0) {
      fail(`Output directory must be empty: ${dir}`);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function assertNoOverwrite(file) {
  if (fs.existsSync(file)) {
    fail(`Refusing to overwrite existing file: ${file}`);
  }
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, value, mode = 0o600) {
  fs.writeFileSync(file, value, { encoding: 'utf8', mode });
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeJsonNoOverwriteOrIdentical(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== next) {
      fail(`Refusing to overwrite existing non-identical file: ${file}`);
    }
    return false;
  }
  writeText(file, next);
  return true;
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function safeFileInventory(dir, expectedNames) {
  assertExactInventory(dir, expectedNames);
  return expectedNames
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        fail(`Symlink is not allowed in external inventory: ${name}`);
      }
      if (!stat.isFile()) {
        fail(`Expected regular file in external inventory: ${name}`);
      }
      return {
        relative_path: name,
        file_type: 'regular',
        byte_size: stat.size,
        sha256: sha256File(file),
      };
    })
    .sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function treeDigest(inventory) {
  return sha256Text(stableJson(inventory.map(({ relative_path, byte_size, sha256 }) => ({
    relative_path,
    byte_size,
    sha256,
  }))));
}

function fileShaIfExists(file) {
  return fs.existsSync(file) ? sha256File(file) : '';
}

function parseArgs(argv) {
  const options = {
    handoffDir: DEFAULT_HANDOFF_DIR,
    freezeFile: DEFAULT_FREEZE_FILE,
    receiptFile: DEFAULT_RECEIPT_FILE,
    authorityFile: DEFAULT_AUTHORITY_FILE,
    pointerStateFile: DEFAULT_POINTER_STATE_FILE,
    pointerStateRequested: false,
    evidenceDir: '',
    requireCheckoutHygiene: false,
    requireCompletePreviousPointer: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        fail(`${arg} requires a value`);
      }
      return argv[index];
    };
    switch (arg) {
      case '--handoff-dir':
      case '--output-dir':
        options.handoffDir = path.resolve(next());
        break;
      case '--freeze-file':
        options.freezeFile = path.resolve(next());
        break;
      case '--evidence-dir':
        options.evidenceDir = path.resolve(next());
        break;
      case '--receipt-file':
      case '--output-file':
        options.receiptFile = path.resolve(next());
        break;
      case '--authority-file':
      case '--authority':
        options.authorityFile = path.resolve(next());
        break;
      case '--pointer-state-file':
      case '--state-file':
        options.pointerStateFile = path.resolve(next());
        options.pointerStateRequested = true;
        break;
      case '--create-pointer-state':
        options.pointerStateRequested = true;
        break;
      case '--require-checkout-hygiene':
        options.requireCheckoutHygiene = true;
        break;
      case '--require-complete-previous-pointer':
        options.requireCompletePreviousPointer = true;
        break;
      default:
        positional.push(arg);
        break;
    }
  }
  return { positional, options };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    const stdout = String(result.stdout ?? '').trim();
    fail(`Command failed: ${command} ${args.join(' ')}${stderr ? `\n${stderr}` : ''}${stdout ? `\n${stdout}` : ''}`);
  }
  return String(result.stdout ?? '');
}

function tryRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    status: result.status,
    error: result.error,
  };
}

function git(args, options = {}) {
  return run('git', args, options).trim();
}

function currentGitCommit() {
  return git(['rev-parse', 'HEAD']);
}

function normalizeCanonicalGitHubHttpsRepositoryRemote(remote) {
  const trimmed = String(remote ?? '').trim();
  const match = trimmed.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) {
    return trimmed;
  }
  return `https://github.com/${match[1]}/${match[2]}`;
}

function isCanonicalRemote(remote) {
  return normalizeCanonicalGitHubHttpsRepositoryRemote(remote) === CANONICAL_REMOTE;
}

function assertLfOnly(name, content) {
  if (content.includes('\r')) {
    fail(`${name} contains CRLF/CR bytes`);
  }
}

function scanForSecrets(name, content) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      fail(`${name} contains a secret-looking assignment or private key marker`);
    }
  }
}

function readAndValidateTextFile(dir, name) {
  const file = path.join(dir, name);
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    fail(`Symlink is not allowed in bundle: ${name}`);
  }
  if (!stat.isFile()) {
    fail(`Expected regular file in bundle: ${name}`);
  }
  const content = readText(file);
  assertLfOnly(name, content);
  scanForSecrets(name, content);
  return content;
}

function parseChecksumFile(content) {
  const checksums = new Map();
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/);
    if (!match) {
      fail(`Invalid checksum line: ${line}`);
    }
    const [, hash, name] = match;
    if (checksums.has(name)) {
      fail(`Duplicate checksum entry: ${name}`);
    }
    checksums.set(name, hash);
  }
  return checksums;
}

function writeChecksums(dir, names) {
  const lines = names.map((name) => `${sha256File(path.join(dir, name))}  ${name}`);
  writeText(path.join(dir, 'checksums.sha256'), `${lines.join('\n')}\n`);
}

function verifyChecksums(dir, expectedNames) {
  const checksumsContent = readAndValidateTextFile(dir, 'checksums.sha256');
  const checksums = parseChecksumFile(checksumsContent);
  const expected = expectedNames.filter((name) => name !== 'checksums.sha256').sort();
  const actual = [...checksums.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`Checksum inventory mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
  for (const [name, expectedHash] of checksums) {
    const actualHash = sha256File(path.join(dir, name));
    if (actualHash !== expectedHash) {
      fail(`Checksum mismatch for ${name}`);
    }
  }
  return Object.fromEntries(checksums);
}

function assertExactInventory(dir, expectedNames) {
  const entries = fs.readdirSync(dir).sort();
  const expected = [...expectedNames].sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`Inventory mismatch in ${dir}: expected ${expected.join(', ')}, got ${entries.join(', ')}`);
  }
}

function staticScanCollector(content) {
  const forbidden = [
    { label: 'git fetch/pull/switch/checkout/reset/clean/restore/stash/add/commit', pattern: /(^|[;&|()])\s*git\s+(?:-[^\s]+\s+)*(?:fetch|pull|switch|checkout|reset|clean|restore|stash|add|commit)\b/m },
    { label: 'docker build/pull/push/load', pattern: /(^|[;&|()])\s*docker\s+(?:build|pull|push|load)\b/m },
    { label: 'docker compose mutation', pattern: /(^|[;&|()])\s*docker\s+compose\b[^\n\r]*(?:\s|^)(?:up|down|restart|stop|rm|run|create)\b/m },
    { label: 'docker logs', pattern: /(^|[;&|()])\s*docker\s+logs\b/m },
    { label: 'journalctl', pattern: /(^|[;&|()])\s*journalctl\b/m },
    { label: 'sudo', pattern: /(^|[;&|()])\s*sudo\b/m },
    { label: 'package install', pattern: /\b(?:npm|pnpm|yarn|apt|apt-get|apk|yum|dnf)\s+(?:install|add)\b/ },
    { label: 'database or redis client', pattern: /(^|[;&|()])\s*(?:psql|redis-cli)\b/m },
    { label: 'HTTP probe', pattern: /(^|[;&|()])\s*(?:curl|wget)\b/m },
    { label: 'shell tracing', pattern: /set\s+-x/ },
    { label: 'environment dump', pattern: /(^|[;&|()])\s*(?:env|printenv)(?:\s|$)/m },
    { label: 'sourcing shell file', pattern: /(^|[;&|()])\s*(?:source|\.)\s+[-A-Za-z0-9_/.]/m },
    { label: 'env file dump', pattern: /(^|[;&|()])\s*(?:cat|grep|sed)\b[^\n\r]*(?:\.env|runtime-image\.env)/m },
  ];
  for (const entry of forbidden) {
    if (entry.pattern.test(content)) {
      fail(`Collector contains forbidden operation: ${entry.label}`);
    }
  }
}

function assertBashSyntax(scriptFile) {
  const bash = process.platform === 'win32' ? 'bash.exe' : 'bash';
  let bashPaths = [scriptFile];
  if (process.platform === 'win32') {
    const normalized = scriptFile.replaceAll('\\', '/');
    const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
    bashPaths = match
      ? [`/${match[1].toLowerCase()}/${match[2]}`, `/mnt/${match[1].toLowerCase()}/${match[2]}`, normalized]
      : [normalized];
  }
  const results = bashPaths.map((bashPath) => tryRun(bash, ['-n', bashPath], { cwd: REPO_ROOT }));
  const result = results.find((candidate) => candidate.ok) ?? results[results.length - 1];
  if (!result.ok) {
    const detail = result.error?.message ?? result.stderr.trim() ?? 'bash -n failed';
    fail(`Bash syntax check failed for ${scriptFile}: ${detail}`);
  }
}

function generateReadme(sourceCommit) {
  return `# ${MILESTONE} Production Checkout Pointer Handoff v1

This bundle is a read-only operator handoff for ${SERVICE_NAME}. It does not
prove current production checkout hygiene by itself; it only gives the operator a
self-contained collector and a contract for returned evidence.

## Scope

- production Git checkout hygiene
- current main-service runtime image pointer identity
- optional previous rollback pointer identity
- future rollback pointer rotation state contract

Out of scope: edge body-limit, MS-019F-R1 operational-smoke/error-signal evidence,
deployment, backup/restore, migrations, Docker build/pull/push, and any public
traffic probe.

## Operator Collection

\`\`\`sh
./collect-production-checkout-pointer-evidence.sh \\
  --repository-dir /path/to/main-service \\
  --compose-file deploy/production/compose.yaml \\
  --shared-env .env.production \\
  --runtime-image-env deploy/runtime-image.env \\
  --output-dir /path/to/empty/production-checkout-pointer-returned-v1
\`\`\`

If an already-recorded previous rollback pointer exists, pass it explicitly:

\`\`\`sh
  --previous-pointer-file /path/to/previous-main-service-release.env
\`\`\`

The previous pointer file is never sourced. It must contain only:

\`\`\`text
PREVIOUS_COMMIT=<40-hex-commit>
PREVIOUS_IMAGE_ID=sha256:<64-hex-image-id>
\`\`\`

Optional version marker:

\`\`\`text
POINTER_CONTRACT_VERSION=${DEFAULT_PREVIOUS_STATE_SCHEMA}
\`\`\`

The returned bundle inventory is exactly:

- collector-metadata.txt
- evidence-records.tsv
- checksums.sha256

## Result Boundary

A missing previous pointer is reported as \`PREVIOUS_POINTER_NOT_RECORDED\`. It
is not inferred from recency, image tags, staging state, or current runtime
identity. Complete rollback-pointer acceptance requires a strict previous pointer
file and matching local image metadata.

Generated from repository commit \`${sourceCommit}\`.
`;
}

function generateContract(sourceCommit) {
  return {
    contract_version: CONTRACT_VERSION,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    canonical_remote: CANONICAL_REMOTE,
    generated_from_commit: sourceCommit,
    collector: {
      file: HANDOFF_COLLECTOR,
      read_only: true,
      production_mutation: false,
      host_runtime_dependencies: ['bash', 'git', 'docker', 'docker compose v2', 'sha256sum|shasum|openssl'],
      forbidden_operations: [
        'git fetch/pull/switch/checkout/reset/clean/restore/stash/add/commit',
        'Docker build/pull/push/load',
        'Docker Compose up/down/restart/stop/rm/run/create',
        'Docker logs or journalctl',
        'HTTP authenticated or public probes',
        'database or Redis commands',
        'package installation',
        'secret or env dump',
      ],
    },
    inputs: {
      required: ['--repository-dir', '--compose-file', '--shared-env', '--runtime-image-env', '--output-dir'],
      optional: ['--previous-pointer-file'],
    },
    returned_inventory: EVIDENCE_FILES,
    checkout_classifications: [...CHECKOUT_CLASSIFICATIONS].sort(),
    successful_checkout_classifications: [...SUCCESS_CHECKOUT_CLASSES].sort(),
    previous_pointer: {
      absent_status: 'PREVIOUS_POINTER_NOT_RECORDED',
      strict_file_keys: ['PREVIOUS_COMMIT', 'PREVIOUS_IMAGE_ID'],
      optional_version_key: 'POINTER_CONTRACT_VERSION',
      optional_version_value: DEFAULT_PREVIOUS_STATE_SCHEMA,
      no_inference_sources: ['recency', 'image tags', 'staging evidence', 'current image equality'],
    },
    receipt_outcomes: ['SUCCESS', 'PARTIAL_ACCEPTED', 'BLOCKED'],
  };
}

function generateManifest(sourceCommit) {
  return {
    manifest_version: 1,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    contract_version: CONTRACT_VERSION,
    canonical_remote: CANONICAL_REMOTE,
    source_commit: sourceCommit,
    generated_at_utc: new Date().toISOString(),
    files: HANDOFF_FILES,
  };
}

function generateHandoff(options) {
  const sourceCommit = currentGitCommit();
  const handoffDir = options.handoffDir;
  ensureEmptyOutputDir(handoffDir);

  const sourceCollector = readText(SOURCE_COLLECTOR).replaceAll('__MS019D_SOURCE_COMMIT__', sourceCommit);
  assertLfOnly('source collector', sourceCollector);
  staticScanCollector(sourceCollector);

  writeText(path.join(handoffDir, 'README.md'), generateReadme(sourceCommit));
  writeText(path.join(handoffDir, HANDOFF_COLLECTOR), sourceCollector, 0o700);
  writeJson(path.join(handoffDir, 'checkout-pointer-contract.json'), generateContract(sourceCommit));
  writeJson(path.join(handoffDir, 'manifest.json'), generateManifest(sourceCommit));
  writeChecksums(handoffDir, HANDOFF_FILES.filter((name) => name !== 'checksums.sha256'));

  verifyHandoff({ ...options, handoffDir });
  console.log(`Wrote ${MILESTONE} handoff-v1 to ${handoffDir}`);
}

function verifyHandoff(options) {
  const handoffDir = options.handoffDir;
  if (!fs.existsSync(handoffDir)) {
    fail(`Handoff directory does not exist: ${handoffDir}`);
  }
  assertExactInventory(handoffDir, HANDOFF_FILES);
  const contents = Object.fromEntries(
    HANDOFF_FILES.map((name) => [name, readAndValidateTextFile(handoffDir, name)]),
  );
  verifyChecksums(handoffDir, HANDOFF_FILES);
  staticScanCollector(contents[HANDOFF_COLLECTOR]);
  assertBashSyntax(path.join(handoffDir, HANDOFF_COLLECTOR));

  const contract = JSON.parse(contents['checkout-pointer-contract.json']);
  if (contract.contract_version !== CONTRACT_VERSION) {
    fail('Contract version mismatch');
  }
  if (contract.milestone !== MILESTONE || contract.service !== SERVICE_NAME) {
    fail('Contract identity mismatch');
  }
  if (normalizeCanonicalGitHubHttpsRepositoryRemote(contract.canonical_remote) !== CANONICAL_REMOTE) {
    fail('Contract canonical remote mismatch');
  }
  if (JSON.stringify(contract.returned_inventory) !== JSON.stringify(EVIDENCE_FILES)) {
    fail('Returned inventory mismatch in contract');
  }

  const manifest = JSON.parse(contents['manifest.json']);
  if (manifest.contract_version !== CONTRACT_VERSION || manifest.milestone !== MILESTONE) {
    fail('Manifest identity mismatch');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(HANDOFF_FILES)) {
    fail('Manifest file inventory mismatch');
  }

  console.log(`Verified ${MILESTONE} handoff-v1 at ${handoffDir}`);
}

function freezeHandoff(options) {
  const handoffDir = options.handoffDir;
  verifyHandoff(options);
  ensureDir(path.dirname(options.freezeFile));
  assertNoOverwrite(options.freezeFile);
  const checksums = parseChecksumFile(readText(path.join(handoffDir, 'checksums.sha256')));
  const freeze = {
    freeze_schema_version: 1,
    milestone: MILESTONE,
    service: SERVICE_NAME,
    contract_version: CONTRACT_VERSION,
    canonical_remote: CANONICAL_REMOTE,
    handoff_dir: handoffDir,
    frozen_at_utc: new Date().toISOString(),
    source_commit: JSON.parse(readText(path.join(handoffDir, 'manifest.json'))).source_commit,
    handoff_inventory: HANDOFF_FILES,
    handoff_checksums_sha256: Object.fromEntries(checksums),
    checksums_file_sha256: sha256File(path.join(handoffDir, 'checksums.sha256')),
  };
  writeJson(options.freezeFile, freeze);
  console.log(`Froze ${MILESTONE} handoff-v1 at ${options.freezeFile}`);
}

function readVerifiedHandoffIdentity(options) {
  verifyHandoff(options);
  const manifestFile = path.join(options.handoffDir, 'manifest.json');
  const contractFile = path.join(options.handoffDir, 'checkout-pointer-contract.json');
  const collectorFile = path.join(options.handoffDir, HANDOFF_COLLECTOR);
  const manifest = JSON.parse(readText(manifestFile));
  const contract = JSON.parse(readText(contractFile));
  if (!fs.existsSync(options.freezeFile)) {
    fail(`Handoff freeze file does not exist: ${options.freezeFile}`);
  }
  const freeze = JSON.parse(readAndValidateTextFile(path.dirname(options.freezeFile), path.basename(options.freezeFile)));
  if (freeze.source_commit !== manifest.source_commit) {
    fail('Freeze source commit does not match handoff manifest');
  }
  if (freeze.handoff_checksums_sha256?.[HANDOFF_COLLECTOR] !== sha256File(collectorFile)) {
    fail('Freeze collector checksum does not match handoff collector');
  }
  if (freeze.handoff_checksums_sha256?.['checkout-pointer-contract.json'] !== sha256File(contractFile)) {
    fail('Freeze contract checksum does not match handoff contract');
  }
  return {
    manifest,
    contract,
    freeze,
    manifest_sha256: sha256File(manifestFile),
    contract_sha256: sha256File(contractFile),
    collector_sha256: sha256File(collectorFile),
    freeze_sha256: sha256File(options.freezeFile),
  };
}

function buildAuthority(options) {
  const handoff = readVerifiedHandoffIdentity(options);
  const inventory = safeFileInventory(options.evidenceDir, EVIDENCE_FILES);
  const digest = treeDigest(inventory);
  const parsed = parseEvidenceDir(options.evidenceDir);
  if (parsed.metadata.source_commit !== handoff.manifest.source_commit) {
    fail('Returned collector source commit does not match frozen handoff source commit');
  }
  if (parsed.metadata.contract_version !== CONTRACT_VERSION) {
    fail('Returned collector contract version mismatch');
  }
  return {
    schema_version: AUTHORITY_SCHEMA_VERSION,
    record_type: 'PRODUCTION_CHECKOUT_POINTER_RETURNED_AUTHORITY',
    milestone: RECEIPT_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    submission_kind: 'LANDED_HANDOFF_V1_CHECKOUT_POINTER_COLLECTION',
    authority_source: 'HUMAN_OPERATOR_EXPLICIT_SUBMISSION',
    selected_input_alias: 'production-checkout-pointer-returned-v1',
    authoritative_tree_digest: digest,
    authoritative_safe_file_count: inventory.length,
    safe_inventory: inventory,
    expected_handoff_source_commit: handoff.manifest.source_commit,
    expected_contract_version: CONTRACT_VERSION,
    handoff_manifest_sha256: handoff.manifest_sha256,
    handoff_collector_sha256: handoff.collector_sha256,
    handoff_contract_sha256: handoff.contract_sha256,
    handoff_freeze_sha256: handoff.freeze_sha256,
    parent_evidence_sha256: {
      ms_018c_basic_acceptance_receipt: '62b0e21bf76f21a5db04698f3d593bf1592d370eef06f50169ab63b2cc3b8163',
      ms_019b_operational_receipt: '3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620',
      ms_019c_combined_backup_restore_receipt: '868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735',
      ms_019c_production_backup: '1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8',
    },
    operator_transcript_used_as_evidence: false,
    validation_bypass_granted: false,
    returned_files_modified_by_codex: false,
    production_contact_performed_by_codex: false,
    production_mutation_performed: false,
    authorization_effective_at_utc: new Date().toISOString(),
  };
}

function createAuthority(options) {
  if (!options.evidenceDir) {
    fail('--evidence-dir is required');
  }
  const authority = buildAuthority(options);
  ensureDir(path.dirname(options.authorityFile));
  writeJsonNoOverwriteOrIdentical(options.authorityFile, authority);
  verifyAuthority(options);
  console.log(`Verified ${RECEIPT_MILESTONE} returned authority at ${options.authorityFile}`);
}

function verifyAuthority(options) {
  if (!options.evidenceDir) {
    fail('--evidence-dir is required');
  }
  if (!fs.existsSync(options.authorityFile)) {
    fail(`Authority file does not exist: ${options.authorityFile}`);
  }
  const expected = buildAuthority(options);
  const actual = JSON.parse(readAndValidateTextFile(path.dirname(options.authorityFile), path.basename(options.authorityFile)));
  const volatileExpected = { ...expected, authorization_effective_at_utc: actual.authorization_effective_at_utc };
  if (stableJson(actual) !== stableJson(volatileExpected)) {
    fail('Authority record does not match current returned evidence identity');
  }
  console.log(`Verified ${RECEIPT_MILESTONE} returned authority at ${options.authorityFile}`);
}

function parseEvidenceDir(evidenceDir) {
  if (!evidenceDir) {
    fail('--evidence-dir is required');
  }
  if (!fs.existsSync(evidenceDir)) {
    fail(`Evidence directory does not exist: ${evidenceDir}`);
  }
  assertExactInventory(evidenceDir, EVIDENCE_FILES);
  const contents = Object.fromEntries(
    EVIDENCE_FILES.map((name) => [name, readAndValidateTextFile(evidenceDir, name)]),
  );
  const checksums = verifyChecksums(evidenceDir, EVIDENCE_FILES);
  const metadata = parseKeyValueLines(contents['collector-metadata.txt'], 'collector metadata');
  const records = parseRecords(contents['evidence-records.tsv']);
  for (const key of Object.keys(metadata)) {
    if (!EXPECTED_METADATA_KEYS.has(key)) {
      fail(`Unexpected collector metadata key: ${key}`);
    }
  }
  for (const key of Object.keys(records)) {
    if (!EXPECTED_RECORD_KEYS.has(key)) {
      fail(`Unexpected evidence record key: ${key}`);
    }
  }
  return { contents, checksums, metadata, records };
}

function parseKeyValueLines(content, label) {
  const result = {};
  for (const line of content.split('\n')) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      fail(`Invalid ${label} line: ${line}`);
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      fail(`Duplicate ${label} key: ${key}`);
    }
    result[key] = value;
  }
  return result;
}

function parseRecords(content) {
  const result = {};
  for (const line of content.split('\n')) {
    if (!line) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length !== 3) {
      fail(`Invalid evidence record line: ${line}`);
    }
    const [section, key, value] = parts;
    if (!section || !key) {
      fail(`Invalid empty evidence record key: ${line}`);
    }
    const compound = `${section}.${key}`;
    if (Object.prototype.hasOwnProperty.call(result, compound)) {
      fail(`Duplicate evidence record: ${compound}`);
    }
    result[compound] = value;
  }
  return result;
}

function requiredRecord(records, key) {
  const value = records[key];
  if (value === undefined) {
    fail(`Missing evidence record: ${key}`);
  }
  return value;
}

function optionalRecord(records, key, fallback = '') {
  return records[key] ?? fallback;
}

function asBoolean(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

function asNonNegativeInteger(value, key) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) {
    fail(`Expected non-negative integer for ${key}`);
  }
  return Number(value);
}

function isCommit(value) {
  return /^[0-9a-f]{40}$/.test(String(value));
}

function isShaImage(value) {
  return /^sha256:[0-9a-f]{64}$/.test(String(value));
}

function makeCheckout(records, blockers) {
  const classification = requiredRecord(records, 'checkout.classification');
  if (!CHECKOUT_CLASSIFICATIONS.has(classification)) {
    fail(`Unknown checkout classification: ${classification}`);
  }
  const counts = {
    tracked_index_change_count: asNonNegativeInteger(requiredRecord(records, 'checkout.tracked_index_change_count'), 'tracked_index_change_count'),
    tracked_worktree_change_count: asNonNegativeInteger(requiredRecord(records, 'checkout.tracked_worktree_change_count'), 'tracked_worktree_change_count'),
    tracked_deletion_count: asNonNegativeInteger(requiredRecord(records, 'checkout.tracked_deletion_count'), 'tracked_deletion_count'),
    unmerged_count: asNonNegativeInteger(requiredRecord(records, 'checkout.unmerged_count'), 'unmerged_count'),
    unknown_untracked_count: asNonNegativeInteger(requiredRecord(records, 'checkout.unknown_untracked_count'), 'unknown_untracked_count'),
    allowlisted_external_state_untracked_count: asNonNegativeInteger(requiredRecord(records, 'checkout.allowlisted_external_state_untracked_count'), 'allowlisted_external_state_untracked_count'),
  };
  const ignorePolicy = {
    operator_state: asBoolean(requiredRecord(records, 'checkout.operator_state_ignore_policy_present')),
    runtime_image_env: asBoolean(requiredRecord(records, 'checkout.deploy_runtime_image_ignore_policy_present')),
    env_production: asBoolean(requiredRecord(records, 'checkout.env_production_ignore_policy_present')),
    overbroad_source_ignore_detected: asBoolean(requiredRecord(records, 'checkout.overbroad_source_ignore_detected')),
  };
  const unknownHashes = optionalRecord(records, 'checkout.unknown_untracked_path_hashes', '');
  if (unknownHashes && !unknownHashes.split(',').every((item) => /^[a-f0-9]{64}$/.test(item))) {
    fail('Unknown untracked path hashes are malformed');
  }

  const strictHygienePassed =
    SUCCESS_CHECKOUT_CLASSES.has(classification) &&
    counts.tracked_index_change_count === 0 &&
    counts.tracked_worktree_change_count === 0 &&
    counts.tracked_deletion_count === 0 &&
    counts.unmerged_count === 0 &&
    counts.unknown_untracked_count === 0 &&
    counts.allowlisted_external_state_untracked_count === 0 &&
    ignorePolicy.operator_state === true &&
    ignorePolicy.runtime_image_env === true &&
    ignorePolicy.env_production === true &&
    ignorePolicy.overbroad_source_ignore_detected === false;

  if (!strictHygienePassed) {
    blockers.push(`checkout_hygiene_not_passed:${classification}`);
  }

  return {
    classification,
    strict_hygiene_passed: strictHygienePassed,
    counts,
    unknown_untracked_path_hashes: unknownHashes ? unknownHashes.split(',') : [],
    ignore_policy: ignorePolicy,
  };
}

function makeRepository(records, blockers) {
  const remoteUrl = requiredRecord(records, 'git.remote_url');
  const normalizedRemote = normalizeCanonicalGitHubHttpsRepositoryRemote(remoteUrl);
  const headCommit = requiredRecord(records, 'git.head_commit');
  const originMainCommit = requiredRecord(records, 'git.origin_main_commit');
  const branchName = requiredRecord(records, 'git.branch_name');
  const headIsOriginMain = asBoolean(requiredRecord(records, 'git.head_is_origin_main'));
  const headReachableFromOriginMain = asBoolean(requiredRecord(records, 'git.head_reachable_from_origin_main'));
  const operationFlags = {
    merge_in_progress: asBoolean(requiredRecord(records, 'git.merge_in_progress')),
    cherry_pick_in_progress: asBoolean(requiredRecord(records, 'git.cherry_pick_in_progress')),
    revert_in_progress: asBoolean(requiredRecord(records, 'git.revert_in_progress')),
    rebase_apply_in_progress: asBoolean(requiredRecord(records, 'git.rebase_apply_in_progress')),
    rebase_merge_in_progress: asBoolean(requiredRecord(records, 'git.rebase_merge_in_progress')),
  };
  if (!isCanonicalRemote(remoteUrl)) {
    blockers.push('repository_remote_not_canonical');
  }
  if (branchName !== 'main') {
    blockers.push(`repository_branch_not_main:${branchName}`);
  }
  if (!isCommit(headCommit)) {
    blockers.push('repository_head_commit_invalid');
  }
  if (!isCommit(originMainCommit)) {
    blockers.push('repository_origin_main_commit_invalid');
  }
  if (headIsOriginMain !== true) {
    blockers.push('repository_head_not_origin_main');
  }
  if (headReachableFromOriginMain !== true) {
    blockers.push('repository_head_not_reachable_from_origin_main');
  }
  for (const [key, value] of Object.entries(operationFlags)) {
    if (value === true) {
      blockers.push(`repository_${key}`);
    }
  }
  return {
    remote_url: remoteUrl,
    normalized_remote: normalizedRemote,
    canonical_remote: CANONICAL_REMOTE,
    canonical_remote_match: normalizedRemote === CANONICAL_REMOTE,
    branch_name: branchName,
    head_commit: headCommit,
    origin_main_commit: originMainCommit,
    head_is_origin_main: headIsOriginMain,
    head_reachable_from_origin_main: headReachableFromOriginMain,
    is_shallow_repository: requiredRecord(records, 'git.is_shallow_repository'),
    operation_flags: operationFlags,
  };
}

function makeCurrentPointer(records, blockers) {
  const runtimeImage = optionalRecord(records, 'runtime.main_service_image', '');
  const runtimeImageId = requiredRecord(records, 'current_pointer.runtime_image_id');
  const apiImageId = requiredRecord(records, 'current_pointer.api_image_id');
  const workerImageId = requiredRecord(records, 'current_pointer.worker_image_id');
  const revision = requiredRecord(records, 'current_pointer.image_revision');
  const source = requiredRecord(records, 'current_pointer.image_source');
  const sourceCanonical = normalizeCanonicalGitHubHttpsRepositoryRemote(source) === CANONICAL_REMOTE;
  const facts = {
    api_container_present: asBoolean(requiredRecord(records, 'runtime.api_container_present')),
    worker_container_present: asBoolean(requiredRecord(records, 'runtime.worker_container_present')),
    api_worker_image_match: asBoolean(requiredRecord(records, 'current_pointer.api_worker_image_match')),
    runtime_image_matches_api: asBoolean(requiredRecord(records, 'current_pointer.runtime_image_matches_api')),
    revision_exists_in_checkout: asBoolean(requiredRecord(records, 'current_pointer.revision_exists_in_checkout')),
    revision_reachable_from_origin_main: asBoolean(requiredRecord(records, 'current_pointer.revision_reachable_from_origin_main')),
    revision_matches_checkout_head: asBoolean(requiredRecord(records, 'current_pointer.revision_matches_checkout_head')),
  };
  if (facts.revision_matches_checkout_head === null) {
    fail('Current pointer checkout/runtime match boolean is malformed');
  }
  const skipLocalHistoryCheck = process.env.MS019D_SKIP_LOCAL_GIT_HISTORY_CHECK === '1';
  const localRevisionExists = skipLocalHistoryCheck || (isCommit(revision) && tryRun('git', ['cat-file', '-e', `${revision}^{commit}`]).ok);
  const localRevisionReachableFromOriginMain =
    skipLocalHistoryCheck || (isCommit(revision) && tryRun('git', ['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']).ok);
  const currentPointerPassed =
    Boolean(runtimeImage) &&
    isShaImage(runtimeImageId) &&
    runtimeImageId === apiImageId &&
    runtimeImageId === workerImageId &&
    isCommit(revision) &&
    sourceCanonical &&
    facts.api_container_present === true &&
    facts.worker_container_present === true &&
    facts.api_worker_image_match === true &&
    facts.runtime_image_matches_api === true &&
    facts.revision_exists_in_checkout === true &&
    facts.revision_reachable_from_origin_main === true &&
    localRevisionExists &&
    localRevisionReachableFromOriginMain;
  if (!currentPointerPassed) {
    blockers.push('current_pointer_not_verified');
  }
  return {
    status: currentPointerPassed ? 'VERIFIED' : 'BLOCKED',
    runtime_image: runtimeImage,
    runtime_image_id: runtimeImageId,
    api_image_id: apiImageId,
    worker_image_id: workerImageId,
    image_revision: revision,
    image_source: source,
    image_source_canonical_match: sourceCanonical,
    local_revision_exists: localRevisionExists,
    local_revision_reachable_from_origin_main: localRevisionReachableFromOriginMain,
    facts,
  };
}

function makePreviousPointer(records, blockers) {
  const sourceStatus = requiredRecord(records, 'previous_pointer.source_status');
  const result = requiredRecord(records, 'previous_pointer.verification_result');
  if (!PREVIOUS_POINTER_RESULTS.has(result)) {
    fail(`Unknown previous pointer result: ${result}`);
  }
  const previous = {
    status: result,
    source_status: sourceStatus,
    commit: optionalRecord(records, 'previous_pointer.commit', ''),
    image_id: optionalRecord(records, 'previous_pointer.image_id', ''),
    image_revision: optionalRecord(records, 'previous_pointer.image_revision', ''),
    image_source: optionalRecord(records, 'previous_pointer.image_source', ''),
    commit_exists_in_checkout: asBoolean(optionalRecord(records, 'previous_pointer.commit_exists_in_checkout', 'false')),
    commit_reachable_from_origin_main: asBoolean(optionalRecord(records, 'previous_pointer.commit_reachable_from_origin_main', 'false')),
    image_revision_matches_commit: asBoolean(optionalRecord(records, 'previous_pointer.image_revision_matches_commit', 'false')),
    image_differs_from_current: asBoolean(optionalRecord(records, 'previous_pointer.image_differs_from_current', 'false')),
  };

  if (result === 'VERIFIED') {
    const sourceCanonical = normalizeCanonicalGitHubHttpsRepositoryRemote(previous.image_source) === CANONICAL_REMOTE;
    if (
      sourceStatus !== 'STRICT_POINTER_FILE' ||
      !isCommit(previous.commit) ||
      !isShaImage(previous.image_id) ||
      previous.image_revision !== previous.commit ||
      previous.commit_exists_in_checkout !== true ||
      previous.commit_reachable_from_origin_main !== true ||
      previous.image_revision_matches_commit !== true ||
      previous.image_differs_from_current !== true ||
      !sourceCanonical
    ) {
      fail('Previous pointer cannot be VERIFIED with inconsistent fields');
    }
    previous.image_source_canonical_match = true;
  } else if (result === 'PREVIOUS_POINTER_NOT_RECORDED') {
    if (sourceStatus !== 'NOT_RECORDED') {
      fail('Previous pointer NOT_RECORDED result requires NOT_RECORDED source status');
    }
  } else {
    blockers.push(`previous_pointer_blocked:${sourceStatus}`);
  }
  return previous;
}

function makeReceiptCore(options) {
  const evidenceDir = options.evidenceDir;
  const parsed = parseEvidenceDir(evidenceDir);
  const blockers = [];
  const metadata = parsed.metadata;
  if (metadata.milestone !== MILESTONE || metadata.service !== SERVICE_NAME) {
    fail('Collector metadata identity mismatch');
  }
  if (metadata.contract_version !== CONTRACT_VERSION) {
    fail('Collector metadata contract version mismatch');
  }
  if (metadata.production_mutation !== 'false' || metadata.read_only !== 'true') {
    fail('Collector metadata must assert read_only=true and production_mutation=false');
  }
  const repository = makeRepository(parsed.records, blockers);
  const checkout = makeCheckout(parsed.records, blockers);
  const currentPointer = makeCurrentPointer(parsed.records, blockers);
  const previousPointer = makePreviousPointer(parsed.records, blockers);
  let authority = null;
  if (fs.existsSync(options.authorityFile)) {
    verifyAuthority(options);
    authority = {
      file: options.authorityFile,
      sha256: sha256File(options.authorityFile),
      authoritative_tree_digest: JSON.parse(readText(options.authorityFile)).authoritative_tree_digest,
    };
  }

  const residualGaps = [];
  if (previousPointer.status === 'PREVIOUS_POINTER_NOT_RECORDED') {
    residualGaps.push('previous_pointer_not_recorded');
  }

  let outcome = 'BLOCKED';
  if (
    checkout.strict_hygiene_passed &&
    currentPointer.status === 'VERIFIED' &&
    repository.canonical_remote_match &&
    repository.branch_name === 'main' &&
    repository.head_is_origin_main === true &&
    previousPointer.status === 'VERIFIED'
  ) {
    outcome = 'SUCCESS';
  } else if (
    checkout.strict_hygiene_passed &&
    currentPointer.status === 'VERIFIED' &&
    repository.canonical_remote_match &&
    repository.branch_name === 'main' &&
    repository.head_is_origin_main === true &&
    previousPointer.status === 'PREVIOUS_POINTER_NOT_RECORDED'
  ) {
    outcome = 'PARTIAL_ACCEPTED';
  }

  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    milestone: RECEIPT_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    contract_version: CONTRACT_VERSION,
    generated_at_utc: new Date().toISOString(),
    evidence_bundle: {
      directory: evidenceDir,
      inventory: EVIDENCE_FILES,
      checksums_sha256: parsed.checksums,
      collector_metadata_sha256: sha256File(path.join(evidenceDir, 'collector-metadata.txt')),
      evidence_records_sha256: sha256File(path.join(evidenceDir, 'evidence-records.tsv')),
    },
    collector: {
      source_commit: metadata.source_commit,
      canonical_remote: metadata.canonical_remote,
      read_only: metadata.read_only === 'true',
      production_mutation: metadata.production_mutation === 'true',
    },
    authority,
    repository,
    checkout,
    current_pointer: currentPointer,
    previous_pointer: previousPointer,
    rollback_baseline_state: null,
    parent_evidence_sha256: {
      ms_018c_basic_acceptance_receipt: '62b0e21bf76f21a5db04698f3d593bf1592d370eef06f50169ab63b2cc3b8163',
      ms_019b_operational_receipt: '3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620',
      ms_019c_combined_backup_restore_receipt: '868b13b9cfe44962daa4abbec71310473e1df1d0a49e4bf156a4c3f77ed01735',
      ms_019c_production_backup: '1bc52dfbf43a4bdeed64c072ab6dbaaadcb09207bc6bd4958a4821ed67e871f8',
    },
    outcome,
    blockers: [...new Set(blockers)],
    residual_gaps: residualGaps,
    no_mutation_flags: {
      production_contact_performed_by_codex: false,
      production_mutation_performed: false,
      deployment: false,
      restart: false,
      migration: false,
      backup: false,
      restore: false,
      artifact_publication: false,
      git_tag: false,
      github_release: false,
    },
    explicitly_not_evidence_for: [
      'edge_body_limit',
      'operational_smoke_error_signal',
      'long_term_stability_not_applicable_by_governance',
      'application_acceptance_regression',
    ],
  };
  return receipt;
}

function buildPointerState(receipt) {
  if (receipt.checkout.strict_hygiene_passed !== true || receipt.current_pointer.status !== 'VERIFIED') {
    fail('Pointer state requires strict checkout hygiene and verified current pointer');
  }
  const previousVerified = receipt.previous_pointer.status === 'VERIFIED';
  return {
    schema_version: DEFAULT_PREVIOUS_STATE_SCHEMA,
    record_type: 'PRODUCTION_RELEASE_POINTER_STATE',
    milestone: RECEIPT_MILESTONE,
    service: SERVICE_NAME,
    environment: 'production',
    collected_at_utc: receipt.generated_at_utc,
    canonical_remote: CANONICAL_REMOTE,
    checkout_hygiene_result: 'PASSED',
    current_pointer_verification_result: receipt.current_pointer.status,
    current_pointer: {
      commit: receipt.current_pointer.image_revision,
      image_id: receipt.current_pointer.runtime_image_id,
      image_source: receipt.current_pointer.image_source,
      checkout_runtime_match: receipt.current_pointer.facts.revision_matches_checkout_head,
    },
    historical_previous_pointer: previousVerified
      ? {
          status: 'VERIFIED',
          commit: receipt.previous_pointer.commit,
          image_id: receipt.previous_pointer.image_id,
        }
      : 'NOT_RECORDED',
    rollback_baseline_for_next_deployment: previousVerified
      ? 'ESTABLISHED_WITH_VERIFIED_PREVIOUS_POINTER'
      : 'ESTABLISHED_FROM_CURRENT_POINTER',
    next_deployment_rotation_contract:
      'Before the next runtime mutation, the then-current verified commit/image must be rotated into previous pointer state.',
    source_authority_sha256: receipt.authority?.sha256 ?? null,
    source_evidence_tree_digest: receipt.authority?.authoritative_tree_digest ?? null,
    production_mutation: false,
    deployment: false,
    secret_included: false,
  };
}

function ensurePointerStateForReceipt(options, receipt) {
  if (receipt.checkout.strict_hygiene_passed !== true || receipt.current_pointer.status !== 'VERIFIED') {
    return null;
  }
  const state = buildPointerState(receipt);
  ensureDir(path.dirname(options.pointerStateFile));
  writeJsonNoOverwriteOrIdentical(options.pointerStateFile, state);
  verifyPointerState({ ...options, receiptObject: receipt });
  return {
    file: options.pointerStateFile,
    sha256: sha256File(options.pointerStateFile),
    result: state.rollback_baseline_for_next_deployment,
  };
}

function createReceipt(options) {
  const receipt = makeReceiptCore(options);
  const pointerState = options.pointerStateRequested ? ensurePointerStateForReceipt(options, receipt) : null;
  receipt.rollback_baseline_state = pointerState;

  scanForSecrets('receipt', JSON.stringify(receipt));
  ensureDir(path.dirname(options.receiptFile));
  writeJsonNoOverwriteOrIdentical(options.receiptFile, receipt);
  console.log(`Wrote ${RECEIPT_MILESTONE} checkout pointer receipt to ${options.receiptFile}`);
}

function createPointerState(options) {
  if (!fs.existsSync(options.receiptFile)) {
    fail(`Receipt file does not exist: ${options.receiptFile}`);
  }
  const receipt = JSON.parse(readAndValidateTextFile(path.dirname(options.receiptFile), path.basename(options.receiptFile)));
  const state = buildPointerState(receipt);
  ensureDir(path.dirname(options.pointerStateFile));
  writeJsonNoOverwriteOrIdentical(options.pointerStateFile, state);
  verifyPointerState(options);
  console.log(`Verified ${RECEIPT_MILESTONE} rollback baseline state at ${options.pointerStateFile}`);
}

function verifyPointerState(options) {
  if (!fs.existsSync(options.pointerStateFile)) {
    fail(`Pointer state file does not exist: ${options.pointerStateFile}`);
  }
  const state = JSON.parse(readAndValidateTextFile(path.dirname(options.pointerStateFile), path.basename(options.pointerStateFile)));
  const receipt =
    options.receiptObject ??
    (fs.existsSync(options.receiptFile)
      ? JSON.parse(readAndValidateTextFile(path.dirname(options.receiptFile), path.basename(options.receiptFile)))
      : null);
  if (state.schema_version !== DEFAULT_PREVIOUS_STATE_SCHEMA || state.record_type !== 'PRODUCTION_RELEASE_POINTER_STATE') {
    fail('Pointer state identity mismatch');
  }
  if (state.milestone !== RECEIPT_MILESTONE || state.service !== SERVICE_NAME || state.environment !== 'production') {
    fail('Pointer state service or milestone mismatch');
  }
  if (state.production_mutation !== false || state.deployment !== false || state.secret_included !== false) {
    fail('Pointer state safety flags mismatch');
  }
  if (receipt) {
    if (receipt.checkout?.strict_hygiene_passed !== true || receipt.current_pointer?.status !== 'VERIFIED') {
      fail('Pointer state cannot bind an unaccepted receipt');
    }
    if (state.current_pointer?.commit !== receipt.current_pointer.image_revision) {
      fail('Pointer state current commit does not match receipt current pointer');
    }
    if (state.current_pointer?.image_id !== receipt.current_pointer.runtime_image_id) {
      fail('Pointer state current image does not match receipt current pointer');
    }
    const expectedHistorical = receipt.previous_pointer.status === 'VERIFIED' ? 'VERIFIED' : 'NOT_RECORDED';
    const actualHistorical =
      typeof state.historical_previous_pointer === 'string'
        ? state.historical_previous_pointer
        : state.historical_previous_pointer?.status;
    if (actualHistorical !== expectedHistorical) {
      fail('Pointer state previous pointer status does not match receipt');
    }
  }
  console.log(`Verified ${RECEIPT_MILESTONE} rollback baseline state at ${options.pointerStateFile}`);
}

function verifyReceipt(options) {
  if (!fs.existsSync(options.receiptFile)) {
    fail(`Receipt file does not exist: ${options.receiptFile}`);
  }
  const content = readAndValidateTextFile(path.dirname(options.receiptFile), path.basename(options.receiptFile));
  const receipt = JSON.parse(content);
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) {
    fail('Receipt schema version mismatch');
  }
  if (receipt.milestone !== RECEIPT_MILESTONE || receipt.service !== SERVICE_NAME || receipt.contract_version !== CONTRACT_VERSION) {
    fail('Receipt identity mismatch');
  }
  if (!BLOCKED_OUTCOMES.has(receipt.outcome)) {
    fail(`Unknown receipt outcome: ${receipt.outcome}`);
  }
  if (!Array.isArray(receipt.evidence_bundle?.inventory) || JSON.stringify(receipt.evidence_bundle.inventory) !== JSON.stringify(EVIDENCE_FILES)) {
    fail('Receipt evidence inventory mismatch');
  }
  if (!receipt.repository?.canonical_remote_match) {
    fail('Receipt repository canonical remote did not match');
  }
  if (!CHECKOUT_CLASSIFICATIONS.has(receipt.checkout?.classification)) {
    fail('Receipt checkout classification is invalid');
  }
  if (!['VERIFIED', 'BLOCKED'].includes(receipt.current_pointer?.status)) {
    fail('Receipt current pointer status is invalid');
  }
  if (!PREVIOUS_POINTER_RESULTS.has(receipt.previous_pointer?.status)) {
    fail('Receipt previous pointer status is invalid');
  }
  if (options.requireCheckoutHygiene && receipt.checkout.strict_hygiene_passed !== true) {
    fail(`Checkout hygiene was required but receipt classification is ${receipt.checkout.classification}`);
  }
  if (options.requireCompletePreviousPointer && receipt.previous_pointer.status !== 'VERIFIED') {
    fail(`Complete previous pointer was required but receipt status is ${receipt.previous_pointer.status}`);
  }
  if (receipt.outcome === 'SUCCESS' && receipt.previous_pointer.status !== 'VERIFIED') {
    fail('SUCCESS outcome requires verified previous pointer');
  }
  if (receipt.outcome === 'PARTIAL_ACCEPTED' && receipt.previous_pointer.status !== 'PREVIOUS_POINTER_NOT_RECORDED') {
    fail('PARTIAL_ACCEPTED outcome requires previous pointer not recorded');
  }
  if (receipt.rollback_baseline_state?.sha256) {
    if (receipt.rollback_baseline_state.sha256 !== sha256File(receipt.rollback_baseline_state.file)) {
      fail('Receipt rollback baseline state checksum mismatch');
    }
    verifyPointerState({ ...options, pointerStateFile: receipt.rollback_baseline_state.file, receiptObject: receipt });
  }
  console.log(`Verified ${RECEIPT_MILESTONE} checkout pointer receipt at ${options.receiptFile}`);
}

function usage() {
  return `Usage:
  node scripts/production-checkout-pointer-evidence.mjs handoff [--output-dir <dir>]
  node scripts/production-checkout-pointer-evidence.mjs handoff:verify [--handoff-dir <dir>]
  node scripts/production-checkout-pointer-evidence.mjs handoff:freeze [--handoff-dir <dir>] [--freeze-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs authority:create --evidence-dir <dir> [--authority-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs authority:verify --evidence-dir <dir> [--authority-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs receipt:create --evidence-dir <dir> [--authority-file <file>] [--pointer-state-file <file>] [--output-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs receipt:verify --receipt-file <file> [--require-checkout-hygiene] [--require-complete-previous-pointer]
  node scripts/production-checkout-pointer-evidence.mjs pointer-state:create --receipt-file <file> [--pointer-state-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs pointer-state:verify --receipt-file <file> [--pointer-state-file <file>]
`;
}

async function main() {
  const [command = '', ...rest] = process.argv.slice(2);
  const { options } = parseArgs(rest);
  switch (command) {
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
    case 'pointer-state:create':
      createPointerState(options);
      break;
    case 'pointer-state:verify':
      verifyPointerState(options);
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}${os.EOL}`);
  process.exitCode = 1;
});
