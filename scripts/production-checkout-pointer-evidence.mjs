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
const SERVICE_NAME = 'main-service';
const CANONICAL_REMOTE = 'https://github.com/hktnv/habersoft-rss';
const DEFAULT_PREVIOUS_STATE_SCHEMA = 'production-release-pointer-state-v1';

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

const SECRET_PATTERNS = [
  /\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY|API_KEY)[A-Z0-9_]*\s*=\s*[^ \n\r\t]+/i,
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

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function sha256Text(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function parseArgs(argv) {
  const options = {
    handoffDir: DEFAULT_HANDOFF_DIR,
    freezeFile: DEFAULT_FREEZE_FILE,
    receiptFile: DEFAULT_RECEIPT_FILE,
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

Out of scope: edge body-limit, long-term stability, error-burst evidence,
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
    facts.revision_matches_checkout_head === true;
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

function createReceipt(options) {
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
    milestone: MILESTONE,
    service: SERVICE_NAME,
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
    repository,
    checkout,
    current_pointer: currentPointer,
    previous_pointer: previousPointer,
    outcome,
    blockers: [...new Set(blockers)],
    residual_gaps: residualGaps,
    explicitly_not_evidence_for: [
      'edge_body_limit',
      'long_term_stability',
      'error_burst',
      'application_acceptance_regression',
    ],
  };

  scanForSecrets('receipt', JSON.stringify(receipt));
  ensureDir(path.dirname(options.receiptFile));
  writeJson(options.receiptFile, receipt);
  console.log(`Wrote ${MILESTONE} checkout pointer receipt to ${options.receiptFile}`);
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
  if (receipt.milestone !== MILESTONE || receipt.service !== SERVICE_NAME || receipt.contract_version !== CONTRACT_VERSION) {
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
  console.log(`Verified ${MILESTONE} checkout pointer receipt at ${options.receiptFile}`);
}

function usage() {
  return `Usage:
  node scripts/production-checkout-pointer-evidence.mjs handoff [--output-dir <dir>]
  node scripts/production-checkout-pointer-evidence.mjs handoff:verify [--handoff-dir <dir>]
  node scripts/production-checkout-pointer-evidence.mjs handoff:freeze [--handoff-dir <dir>] [--freeze-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs receipt:create --evidence-dir <dir> [--output-file <file>]
  node scripts/production-checkout-pointer-evidence.mjs receipt:verify --receipt-file <file> [--require-checkout-hygiene] [--require-complete-previous-pointer]
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}${os.EOL}`);
  process.exitCode = 1;
});
