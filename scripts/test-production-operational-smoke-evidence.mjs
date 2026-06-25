#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLogLines, constants, verifySourceContracts } from './production-operational-smoke-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'production-operational-smoke-evidence.mjs');
const HANDOFF_OBSERVER = 'observe-production-operational-smoke.sh';
const HANDOFF_CHECKSUM_FILES = ['README.md', HANDOFF_OBSERVER, 'operational-smoke-contract.json', 'manifest.json'];
const EVIDENCE_CHECKSUM_FILES = ['collector-metadata.txt', 'operational-smoke-samples.tsv', 'error-signal-buckets.tsv'];
const EVIDENCE_FILES = ['checksums.sha256', ...EVIDENCE_CHECKSUM_FILES];
const PUBLIC_HOST = 'rss.habersoft.com';
const temp = mkdtempSync(path.join(os.tmpdir(), 'main-service-ms019f-tests-'));
const bashPathCache = new Map();

try {
  assertConstants();
  assertClassifier();
  assertSourceContract();
  assertGovernanceRegression();
  assertCliFixturePasses();

  const base = createHandoffFixture('base');
  const success = runObserverVariant(base, 'success');
  assert.equal(success.receipt.outcome, 'SUCCESS');
  assert.equal(success.receipt.bounded_operational_smoke_result, 'BOUNDED_OPERATIONAL_SMOKE_WINDOW_VERIFIED');
  assert.equal(success.receipt.bounded_error_signal_result, 'NO_ERROR_LEVEL_SIGNALS');
  assert.equal(success.receipt.long_term_stability_result, 'NOT_APPLICABLE_BY_GOVERNANCE_DECISION');
  assert.equal(success.receipt.claim_boundary.long_term_stability_claim, false);
  nodeCli(['receipt:verify', '--receipt-file', success.receiptFile, '--require-ms019f-v2-baseline']);
  assertReturnedInventorySafe(success.returnedDir);

  assertBlockedVariants(base);
  assertInterruptedRunHasNoFinalBundle(base);
  assertUnknownReceiptFieldFails(success.receiptFile);
  assertUnknownMetadataFieldFails(base);
  assertMissingSampleFails(base);
  assertShortElapsedStrictFails(base);
  assertUnsafeFlagStrictFails(base);
  assertHandoffRejectsChecksumMismatch(base.handoffDir);
  assertHandoffRejectsComposeRun(base.handoffDir);
  assertHandoffRejectsRawLogFile(base.handoffDir);

  console.log('test-production-operational-smoke-evidence: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assertConstants() {
  const value = constants();
  assert.equal(value.CONTRACT_VERSION, 'production-operational-smoke-evidence-v2');
  assert.equal(value.CLASSIFIER_MODE, 'STABLE_SEVERITY_PREFIX');
  assert.equal(value.CONTRACT_VERSION, 'production-operational-smoke-evidence-v2');
  assert.equal(value.WINDOW_CLASS, 'BOUNDED_20M_OPERATIONAL_SMOKE');
  assert.equal(value.WINDOW_MINUTES, 20);
  assert.equal(value.WINDOW_SECONDS, 1200);
  assert.equal(value.PRIMARY_INTERVAL_SECONDS, 60);
  assert.equal(value.PRIMARY_SAMPLE_COUNT, 21);
  assert.equal(value.WORKER_INTERVAL_SECONDS, 300);
  assert.equal(value.WORKER_SAMPLE_COUNT, 5);
  assert.equal(value.ERROR_BUCKET_SECONDS, 60);
  assert.equal(value.ERROR_BUCKET_COUNT, 20);
  assert.equal(value.ERROR_BUCKET_RECORD_COUNT, 40);
  assert.equal(value.MAX_SAMPLE_LAG_SECONDS, 15);
  assert.equal(value.LONG_TERM_STABILITY_STATUS, 'NOT_APPLICABLE_BY_GOVERNANCE_DECISION');
  assert.equal(value.HISTORICAL_V1_SUPERSESSION_CLASS, 'HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN');
}

function assertClassifier() {
  assert.deepEqual(classifyLogLines('info: the word error inside normal text\n'), {
    warning: 0,
    error: 0,
    fatal: 0,
    unsupported: 0,
  });
  assert.deepEqual(
    classifyLogLines([
      '[Nest] 123  - 06/25/2026, 1:00:00 PM ERROR [Bootstrap] failed',
      'stack line that must not become a second error',
      '[Nest] 124  - 06/25/2026, 1:00:01 PM WARN [TenantAuth] refresh',
      'tenant auth JWKS refresh failed: upstream_unavailable',
      'main-service-worker bootstrap failed',
      'Invalid runtime configuration: DATABASE_URL is required',
      '{"level":"error","msg":"unsupported structured logger"}',
    ].join('\n')),
    {
      warning: 2,
      error: 3,
      fatal: 0,
      unsupported: 1,
    },
  );
  assert.deepEqual(classifyLogLines('[Nest] 125  - 06/25/2026, 1:00:02 PM FATAL [Worker] crash\n'), {
    warning: 0,
    error: 0,
    fatal: 1,
    unsupported: 0,
  });
}

function assertSourceContract() {
  const proof = verifySourceContracts();
  assert.equal(proof.status, 'production-operational-smoke-source-contract-verified');
  assert.equal(proof.classifier_mode, 'STABLE_SEVERITY_PREFIX');
  assert.equal(proof.runtime_logging_changed, false);
  assert.equal(proof.raw_log_retention, false);
}

function assertGovernanceRegression() {
  const packageJson = readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8');
  assert.equal(packageJson.includes('test:production-stability-evidence'), false);
  assert.equal(packageJson.includes('production:stability:'), false);
  assert.equal(packageJson.includes('production-stability-evidence.mjs'), false);

  const activeFiles = [
    'scripts/production-operational-smoke-observer.sh',
    'scripts/production-operational-smoke-evidence.mjs',
  ];
  const forbidden = [
    'production-stability',
    'observe-production-stability.sh',
    'stability-samples.tsv',
    '--confirm-window-hours',
    'BOUNDED_24H',
    '86400',
    '0..288',
    '0..48',
  ];
  for (const file of activeFiles) {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    for (const token of forbidden) {
      assert.equal(text.includes(token), false, `${file} contains retired token ${token}`);
    }
  }

  const doc = readFileSync(path.join(REPO_ROOT, '.docs', 'production-operational-smoke-and-error-signals.md'), 'utf8');
  const historicalLine = doc.split('\n').find((line) => line.includes('24-hour')) ?? '';
  assert.match(historicalLine, /historical|governance/i);
  assert.equal(doc.includes('--confirm-window-minutes 20'), true);
  assert.equal(doc.includes('HISTORICAL_SUPERSEDED_GOVERNANCE_REJECTED_NEVER_RUN'), true);
}

function assertCliFixturePasses() {
  const result = nodeCli(['fixture:e2e']);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 'production-operational-smoke-generated-handoff-e2e-passed');
  assert.deepEqual(parsed.returned_inventory, EVIDENCE_FILES.sort());
}

function assertBlockedVariants(base) {
  const cases = [
    ['health', 'BLOCKED_HEALTH_SAMPLE_FAILURE'],
    ['restart', 'BLOCKED_CONTAINER_RESTART'],
    ['lag', 'BLOCKED_SCHEDULING_LAG'],
    ['error', 'BLOCKED_ERROR_SIGNAL_PRESENT'],
    ['fatal', 'BLOCKED_ERROR_SIGNAL_PRESENT'],
    ['loggap', 'BLOCKED_LOG_SIGNAL_COVERAGE'],
  ];
  for (const [variant, expectedOutcome] of cases) {
    const result = runObserverVariant(base, variant);
    assert.equal(result.receipt.outcome, expectedOutcome, variant);
    nodeCliExpectFail(['receipt:verify', '--receipt-file', result.receiptFile, '--require-ms019f-v2-baseline']);
  }
}

function assertInterruptedRunHasNoFinalBundle(base) {
  const runRoot = path.join(temp, 'variant-interrupt');
  mkdirSync(runRoot, { recursive: true });
  const returnedDir = path.join(runRoot, 'returned');
  mkdirSync(returnedDir);
  const result = runGeneratedObserver(base.handoffDir, returnedDir, 'interrupt');
  assert.notEqual(result.status, 0);
  assert.equal(readdirSync(returnedDir).includes('checksums.sha256'), false);
  assert.equal(readdirSync(returnedDir).filter((name) => EVIDENCE_FILES.includes(name)).length, 0);
}

function assertUnknownReceiptFieldFails(receiptFile) {
  const badReceipt = path.join(temp, 'bad-unknown-receipt.json');
  const receipt = readJson(receiptFile);
  receipt.unexpected_field = true;
  writeJson(badReceipt, receipt);
  nodeCliExpectFail(['receipt:verify', '--receipt-file', badReceipt, '--require-ms019f-v2-baseline']);
}

function assertUnknownMetadataFieldFails(base) {
  const result = runObserverVariant(base, 'success', 'unknown-metadata');
  appendText(path.join(result.returnedDir, 'collector-metadata.txt'), 'unexpected_field=true\n');
  writeEvidenceChecksums(result.returnedDir);
  nodeCliExpectFail([
    'receipt:create',
    '--handoff-dir',
    base.handoffDir,
    '--freeze-file',
    base.freezeFile,
    '--evidence-dir',
    result.returnedDir,
    '--receipt-file',
    path.join(temp, 'unknown-metadata-receipt.json'),
  ]);
}

function assertMissingSampleFails(base) {
  const result = runObserverVariant(base, 'success', 'missing-sample');
  const sampleFile = path.join(result.returnedDir, 'operational-smoke-samples.tsv');
  const lines = readFileSync(sampleFile, 'utf8').trimEnd().split('\n');
  writeText(sampleFile, `${lines.slice(0, -1).join('\n')}\n`);
  writeEvidenceChecksums(result.returnedDir);
  nodeCliExpectFail([
    'receipt:create',
    '--handoff-dir',
    base.handoffDir,
    '--freeze-file',
    base.freezeFile,
    '--evidence-dir',
    result.returnedDir,
    '--receipt-file',
    path.join(temp, 'missing-sample-receipt.json'),
  ]);
}

function assertShortElapsedStrictFails(base) {
  const result = runObserverVariant(base, 'success', 'short-elapsed');
  replaceMetadataValue(result.returnedDir, 'elapsed_seconds', '1199');
  const receiptFile = path.join(temp, 'short-elapsed-receipt.json');
  nodeCli([
    'receipt:create',
    '--handoff-dir',
    base.handoffDir,
    '--freeze-file',
    base.freezeFile,
    '--evidence-dir',
    result.returnedDir,
    '--receipt-file',
    receiptFile,
  ]);
  assert.equal(readJson(receiptFile).outcome, 'BLOCKED_SAMPLE_COVERAGE');
  nodeCliExpectFail(['receipt:verify', '--receipt-file', receiptFile, '--require-ms019f-v2-baseline']);
}

function assertUnsafeFlagStrictFails(base) {
  const result = runObserverVariant(base, 'success', 'unsafe-flag');
  replaceMetadataValue(result.returnedDir, 'raw_logs_retained', 'true');
  const receiptFile = path.join(temp, 'unsafe-flag-receipt.json');
  nodeCli([
    'receipt:create',
    '--handoff-dir',
    base.handoffDir,
    '--freeze-file',
    base.freezeFile,
    '--evidence-dir',
    result.returnedDir,
    '--receipt-file',
    receiptFile,
  ]);
  assert.equal(readJson(receiptFile).outcome, 'BLOCKED_EVIDENCE_INTEGRITY');
  nodeCliExpectFail(['receipt:verify', '--receipt-file', receiptFile, '--require-ms019f-v2-baseline']);
}

function assertHandoffRejectsChecksumMismatch(handoffDir) {
  const bad = copyHandoff(handoffDir, 'bad-checksum');
  appendText(path.join(bad, 'README.md'), '\nchecksum mismatch\n');
  nodeCliExpectFail(['handoff:verify', '--handoff-dir', bad]);
}

function assertHandoffRejectsComposeRun(handoffDir) {
  const bad = copyHandoff(handoffDir, 'bad-compose-run');
  appendText(path.join(bad, HANDOFF_OBSERVER), '\ndocker compose run main-service-worker true\n');
  rewriteHandoffChecksums(bad);
  nodeCliExpectFail(['handoff:verify', '--handoff-dir', bad]);
}

function assertHandoffRejectsRawLogFile(handoffDir) {
  const bad = copyHandoff(handoffDir, 'bad-raw-logs');
  appendText(path.join(bad, HANDOFF_OBSERVER), '\ndocker logs "$cid" > raw.log\n');
  rewriteHandoffChecksums(bad);
  nodeCliExpectFail(['handoff:verify', '--handoff-dir', bad]);
}

function createHandoffFixture(name) {
  const root = path.join(temp, name);
  const handoffDir = path.join(root, 'handoff');
  const freezeFile = path.join(root, 'handoff-freeze.json');
  nodeCli(['handoff', '--output-dir', handoffDir]);
  nodeCli(['handoff:verify', '--handoff-dir', handoffDir]);
  nodeCli(['handoff:freeze', '--handoff-dir', handoffDir, '--freeze-file', freezeFile, '--fixture-result', 'PASSED']);
  nodeCli(['handoff:freeze:verify', '--handoff-dir', handoffDir, '--freeze-file', freezeFile]);
  return { handoffDir, freezeFile };
}

function runObserverVariant(base, variant, name = variant) {
  const runRoot = path.join(temp, `variant-${name}`);
  mkdirSync(runRoot, { recursive: true });
  const returnedDir = path.join(runRoot, 'returned');
  mkdirSync(returnedDir);
  const observer = runGeneratedObserver(base.handoffDir, returnedDir, variant);
  assert.equal(observer.status, 0, `${variant}\nstdout=${observer.stdout}\nstderr=${observer.stderr}`);
  const receiptFile = path.join(runRoot, 'receipt.json');
  nodeCli([
    'receipt:create',
    '--handoff-dir',
    base.handoffDir,
    '--freeze-file',
    base.freezeFile,
    '--evidence-dir',
    returnedDir,
    '--receipt-file',
    receiptFile,
  ]);
  return { returnedDir, receiptFile, receipt: readJson(receiptFile) };
}

function runGeneratedObserver(handoffDir, returnedDir, variant) {
  const wrapper = path.join(path.dirname(returnedDir), `run-${variant}.sh`);
  writeText(
    wrapper,
    `#!/usr/bin/env bash
set -eu
MS019F_TEST_MODE=1 MS019F_TEST_VARIANT=${shellQuote(variant)} "$@"
`,
    0o700,
  );
  const args = [
    bashPath(wrapper),
    bashPath(path.join(handoffDir, HANDOFF_OBSERVER)),
    '--repository-dir',
    bashPath(REPO_ROOT),
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
    bashPath(returnedDir),
  ];
  return spawnSync(process.platform === 'win32' ? 'bash.exe' : 'bash', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });
}

function assertReturnedInventorySafe(returnedDir) {
  assert.deepEqual(readdirSync(returnedDir).sort(), [...EVIDENCE_FILES].sort());
  for (const name of EVIDENCE_FILES) {
    const text = readFileSync(path.join(returnedDir, name), 'utf8');
    assert.equal(/DATABASE_URL|POSTGRES_PASSWORD|AGENT_KEY|TENANT_RATE_LIMIT_KEY_SECRET|raw log|docker inspect json/iu.test(text), false, name);
  }
}

function replaceMetadataValue(evidenceDir, key, value) {
  const file = path.join(evidenceDir, 'collector-metadata.txt');
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  assert.equal(replaced, true, `metadata key not found: ${key}`);
  writeText(file, `${next.join('\n')}\n`);
  writeEvidenceChecksums(evidenceDir);
}

function writeEvidenceChecksums(evidenceDir) {
  writeText(
    path.join(evidenceDir, 'checksums.sha256'),
    `${EVIDENCE_CHECKSUM_FILES.map((file) => `${sha256File(path.join(evidenceDir, file))}  ${file}`).join('\n')}\n`,
  );
}

function copyHandoff(source, name) {
  const target = path.join(temp, name);
  cpSync(source, target, { recursive: true });
  return target;
}

function rewriteHandoffChecksums(handoffDir) {
  const manifestFile = path.join(handoffDir, 'manifest.json');
  const manifest = readJson(manifestFile);
  manifest.observer.sha256 = sha256File(path.join(handoffDir, HANDOFF_OBSERVER));
  manifest.contract.sha256 = sha256File(path.join(handoffDir, 'operational-smoke-contract.json'));
  writeJson(manifestFile, manifest);
  writeText(
    path.join(handoffDir, 'checksums.sha256'),
    `${HANDOFF_CHECKSUM_FILES.map((file) => `${sha256File(path.join(handoffDir, file))}  ${file}`).join('\n')}\n`,
  );
}

function nodeCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `node ${CLI} ${args.join(' ')}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return { stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

function nodeCliExpectFail(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0, `Command unexpectedly passed: node ${CLI} ${args.join(' ')}`);
  return `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value, { encoding: 'utf8', mode });
  try {
    chmodSync(file, mode);
  } catch {
    // Windows chmod may be advisory only; Bash reads the wrapper directly.
  }
}

function appendText(file, value) {
  writeFileSync(file, value, { encoding: 'utf8', flag: 'a' });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function windowsPathCandidates(nativePath) {
  const normalized = path.resolve(nativePath).replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  if (!match) {
    return [normalized];
  }
  return [`/mnt/${match[1].toLowerCase()}/${match[2]}`, `/${match[1].toLowerCase()}/${match[2]}`, normalized];
}

function bashPath(nativePath) {
  if (process.platform !== 'win32') {
    return nativePath;
  }
  if (bashPathCache.has(nativePath)) {
    return bashPathCache.get(nativePath);
  }
  for (const candidate of windowsPathCandidates(nativePath)) {
    const root = bashCandidateRoot(candidate);
    const probeTarget = root === '' ? candidate : root;
    const result = spawnSync('bash.exe', ['-lc', `test -e ${shellQuote(probeTarget)}`], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status === 0) {
      bashPathCache.set(nativePath, candidate);
      return candidate;
    }
  }
  const fallback = windowsPathCandidates(nativePath)[0];
  bashPathCache.set(nativePath, fallback);
  return fallback;
}

function bashCandidateRoot(candidate) {
  const mountedDrive = candidate.match(/^(\/mnt\/[a-z])(?:\/|$)/u);
  if (mountedDrive) {
    return mountedDrive[1];
  }
  const slashDrive = candidate.match(/^(\/[a-z])(?:\/|$)/u);
  return slashDrive?.[1] ?? '';
}
