#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'production-checkout-pointer-evidence.mjs');
const HANDOFF_COLLECTOR = 'collect-production-checkout-pointer-evidence.sh';
const CANONICAL_REMOTE = 'https://github.com/hktnv/habersoft-rss';
const CURRENT_IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const PREVIOUS_IMAGE_ID = `sha256:${'b'.repeat(64)}`;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
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
    fail(
      `Command failed: ${command} ${args.join(' ')}\n${String(result.stdout ?? '')}${String(result.stderr ?? '')}`,
    );
  }
  return String(result.stdout ?? '');
}

function runExpectFail(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status === 0) {
    fail(`Command unexpectedly passed: ${command} ${args.join(' ')}`);
  }
  return `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
}

function nodeCli(args, options = {}) {
  return run(process.execPath, [CLI, ...args], options);
}

function nodeCliExpectFail(args, options = {}) {
  return runExpectFail(process.execPath, [CLI, ...args], options);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

function appendText(file, value) {
  fs.appendFileSync(file, value, 'utf8');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function windowsPathCandidates(nativePath) {
  const normalized = nativePath.replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) {
    return [normalized];
  }
  return [`/mnt/${match[1].toLowerCase()}/${match[2]}`, `/${match[1].toLowerCase()}/${match[2]}`, normalized];
}

const bashPathCache = new Map();

function bashPath(nativePath) {
  if (process.platform !== 'win32') {
    return nativePath;
  }
  if (bashPathCache.has(nativePath)) {
    return bashPathCache.get(nativePath);
  }
  for (const candidate of windowsPathCandidates(nativePath)) {
    const result = spawnSync('bash.exe', ['-lc', `test -e ${shellQuote(candidate)}`], {
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

function bashRun(command, env = {}) {
  const executable = process.platform === 'win32' ? 'bash.exe' : 'bash';
  return run(executable, ['-lc', command], {
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      ...env,
    },
  });
}

function bashRunExpectFail(command, env = {}) {
  const executable = process.platform === 'win32' ? 'bash.exe' : 'bash';
  return runExpectFail(executable, ['-lc', command], {
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      ...env,
    },
  });
}

function git(repo, args) {
  return run('git', args, { cwd: repo }).trim();
}

function initGitRepo(repo) {
  fs.mkdirSync(repo, { recursive: true });
  const init = spawnSync('git', ['init', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
  if (init.status !== 0) {
    run('git', ['init'], { cwd: repo });
    run('git', ['checkout', '-b', 'main'], { cwd: repo });
  }
  git(repo, ['config', 'user.email', 'codex@example.invalid']);
  git(repo, ['config', 'user.name', 'Codex Test']);
  git(repo, ['remote', 'add', 'origin', CANONICAL_REMOTE]);
}

function createFixture(root, options = {}) {
  const repo = path.join(root, `fixture-${options.name ?? 'default'}`);
  initGitRepo(repo);
  const ignoreLines = [
    '.env.production',
    'deploy/runtime-image.env',
    options.operatorStateIgnored === false ? '' : 'operator-state/',
    options.overbroadIgnore ? 'src/*.ts' : '',
  ].filter(Boolean);
  writeText(path.join(repo, '.gitignore'), `${ignoreLines.join('\n')}\n`);
  writeText(
    path.join(repo, 'deploy', 'production', 'compose.yaml'),
    [
      'services:',
      '  main-service-api:',
      '    image: ${MAIN_SERVICE_IMAGE}',
      '  main-service-worker:',
      '    image: ${MAIN_SERVICE_IMAGE}',
      '',
    ].join('\n'),
  );
  writeText(path.join(repo, 'README.md'), 'fixture\n');
  git(repo, ['add', '.gitignore', 'deploy/production/compose.yaml', 'README.md']);
  git(repo, ['commit', '-m', 'previous']);
  const previousCommit = git(repo, ['rev-parse', 'HEAD']);
  writeText(path.join(repo, 'README.md'), 'fixture current\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'current']);
  const currentCommit = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', currentCommit]);
  writeText(path.join(repo, '.env.production'), 'POSTGRES_PASSWORD=placeholder-not-read\n');
  writeText(path.join(repo, 'deploy', 'runtime-image.env'), `MAIN_SERVICE_IMAGE=main-service:${currentCommit}\n`);
  if (options.unknownUntracked) {
    writeText(path.join(repo, 'mystery.txt'), 'not tracked\n');
  }
  if (options.operatorStateIgnored === false) {
    writeText(path.join(repo, 'operator-state', 'ms-019d', 'returned.txt'), 'external state\n');
  }
  return { repo, previousCommit, currentCommit };
}

function createFakeDocker(root) {
  const bin = path.join(root, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const docker = path.join(bin, process.platform === 'win32' ? 'docker' : 'docker');
  writeText(
    docker,
    `#!/usr/bin/env bash
set -euo pipefail

if [ -n "\${DOCKER_LOG:-}" ]; then
  printf '%s\\n' "$*" >> "$DOCKER_LOG"
fi

if [ "$#" -lt 1 ]; then
  exit 2
fi

if [ "$1" = "compose" ]; then
  shift
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --env-file|-f)
        shift 2
        ;;
      config)
        shift
        if [ "$#" -eq 1 ] && [ "$1" = "--services" ]; then
          printf 'main-service-api\\nmain-service-worker\\npostgres\\nredis\\n'
          exit 0
        fi
        exit 2
        ;;
      ps)
        shift
        if [ "$#" -ge 2 ] && [ "$1" = "-q" ]; then
          case "$2" in
            main-service-api)
              printf 'api-cid\\n'
              exit 0
              ;;
            main-service-worker)
              printf 'worker-cid\\n'
              exit 0
              ;;
          esac
        fi
        exit 2
        ;;
      *)
        exit 2
        ;;
    esac
  done
fi

if [ "$1" = "inspect" ]; then
  target=""
  for item in "$@"; do
    target="$item"
  done
  case "$target" in
    api-cid|worker-cid)
      printf '%s\\n' "$CURRENT_IMAGE_ID"
      exit 0
      ;;
  esac
fi

if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  image="$3"
  format=""
  shift 3
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --format)
        shift
        format="$1"
        ;;
    esac
    shift || true
  done
  case "$format" in
    *'.Id'*)
      if [ "$image" = "$PREVIOUS_IMAGE_ID" ]; then
        printf '%s\\n' "$PREVIOUS_IMAGE_ID"
      else
        printf '%s\\n' "$CURRENT_IMAGE_ID"
      fi
      exit 0
      ;;
    *'org.opencontainers.image.revision'*)
      if [ "$image" = "$PREVIOUS_IMAGE_ID" ]; then
        printf '%s\\n' "$PREVIOUS_COMMIT"
      else
        printf '%s\\n' "$CURRENT_COMMIT"
      fi
      exit 0
      ;;
    *'org.opencontainers.image.source'*)
      printf '%s\\n' "$CANONICAL_REMOTE"
      exit 0
      ;;
  esac
fi

exit 2
`,
  );
  fs.chmodSync(docker, 0o755);
  bashRun(`chmod +x ${shellQuote(bashPath(docker))}`);
  return { bin, docker };
}

function collectorCommand({ collector, fixture, outputDir, previousPointerFile, fakeBin }) {
  const args = [
    shellQuote(bashPath(collector)),
    '--repository-dir',
    shellQuote(bashPath(fixture.repo)),
    '--compose-file',
    'deploy/production/compose.yaml',
    '--shared-env',
    '.env.production',
    '--runtime-image-env',
    'deploy/runtime-image.env',
    '--output-dir',
    shellQuote(bashPath(outputDir)),
  ];
  if (previousPointerFile) {
    args.push('--previous-pointer-file', shellQuote(bashPath(previousPointerFile)));
  }
  const pathPrefix = shellQuote(bashPath(fakeBin));
  return `export PATH=${pathPrefix}:"$PATH"; bash ${args.join(' ')}`;
}

function runCollector({ collector, fixture, outputDir, previousPointerFile, fakeBin }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const setup = [
    `export CURRENT_COMMIT=${shellQuote(fixture.currentCommit)}`,
    `export PREVIOUS_COMMIT=${shellQuote(fixture.previousCommit)}`,
    `export CURRENT_IMAGE_ID=${shellQuote(CURRENT_IMAGE_ID)}`,
    `export PREVIOUS_IMAGE_ID=${shellQuote(PREVIOUS_IMAGE_ID)}`,
    `export CANONICAL_REMOTE=${shellQuote(CANONICAL_REMOTE)}`,
    `export DOCKER_LOG=${shellQuote(bashPath(path.join(path.dirname(fakeBin), 'docker-args.log')))}`,
  ].join('; ');
  return bashRun(`${setup}; ${collectorCommand({ collector, fixture, outputDir, previousPointerFile, fakeBin })}`);
}

function createReceipt(evidenceDir, receiptFile) {
  nodeCli(['receipt:create', '--evidence-dir', evidenceDir, '--output-file', receiptFile]);
  return JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
}

function rewriteChecksums(handoffDir) {
  const files = ['README.md', HANDOFF_COLLECTOR, 'checkout-pointer-contract.json', 'manifest.json'];
  const lines = files.map((file) => `${sha256File(path.join(handoffDir, file))}  ${file}`);
  writeText(path.join(handoffDir, 'checksums.sha256'), `${lines.join('\n')}\n`);
}

function testHandoffGeneration(root) {
  const handoff = path.join(root, 'handoff');
  nodeCli(['handoff', '--output-dir', handoff]);
  nodeCli(['handoff:verify', '--handoff-dir', handoff]);
  const files = fs.readdirSync(handoff).sort();
  assert(
    JSON.stringify(files) ===
      JSON.stringify(['README.md', 'checkout-pointer-contract.json', 'checksums.sha256', HANDOFF_COLLECTOR, 'manifest.json'].sort()),
    'handoff inventory mismatch',
  );
  const collector = fs.readFileSync(path.join(handoff, HANDOFF_COLLECTOR), 'utf8');
  assert(!collector.includes('\r'), 'collector must be LF-only');
  return handoff;
}

function testNoPreviousPointer(root, handoff, fakeDocker) {
  const fixture = createFixture(root, { name: 'no-prev' });
  const evidence = path.join(root, 'returned-no-prev');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture,
    outputDir: evidence,
    fakeBin: fakeDocker.bin,
  });
  const receiptFile = path.join(root, 'receipt-no-prev.json');
  const receipt = createReceipt(evidence, receiptFile);
  assert(
    receipt.outcome === 'PARTIAL_ACCEPTED',
    `missing previous pointer should produce PARTIAL_ACCEPTED, got ${receipt.outcome}: ${JSON.stringify(receipt.blockers)} ${JSON.stringify(receipt.current_pointer)}`,
  );
  assert(receipt.checkout.strict_hygiene_passed === true, 'checkout hygiene should pass');
  assert(receipt.current_pointer.status === 'VERIFIED', 'current pointer should verify');
  assert(receipt.previous_pointer.status === 'PREVIOUS_POINTER_NOT_RECORDED', 'previous pointer should be not recorded');
  nodeCli(['receipt:verify', '--receipt-file', receiptFile, '--require-checkout-hygiene']);
  nodeCliExpectFail(['receipt:verify', '--receipt-file', receiptFile, '--require-complete-previous-pointer']);
}

function testCompletePreviousPointer(root, handoff, fakeDocker) {
  const fixture = createFixture(root, { name: 'with-prev' });
  const pointerFile = path.join(root, 'previous-main-service-release.env');
  writeText(
    pointerFile,
    [
      'POINTER_CONTRACT_VERSION=production-release-pointer-state-v1',
      `PREVIOUS_COMMIT=${fixture.previousCommit}`,
      `PREVIOUS_IMAGE_ID=${PREVIOUS_IMAGE_ID}`,
      '',
    ].join('\n'),
  );
  const evidence = path.join(root, 'returned-with-prev');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture,
    outputDir: evidence,
    previousPointerFile: pointerFile,
    fakeBin: fakeDocker.bin,
  });
  const receiptFile = path.join(root, 'receipt-with-prev.json');
  const receipt = createReceipt(evidence, receiptFile);
  assert(receipt.outcome === 'SUCCESS', 'verified previous pointer should produce SUCCESS');
  assert(receipt.previous_pointer.status === 'VERIFIED', 'previous pointer should verify');
  nodeCli([
    'receipt:verify',
    '--receipt-file',
    receiptFile,
    '--require-checkout-hygiene',
    '--require-complete-previous-pointer',
  ]);
}

function testDirtyCheckoutClassifications(root, handoff, fakeDocker) {
  const fixture = createFixture(root, { name: 'unknown', unknownUntracked: true });
  const evidence = path.join(root, 'returned-unknown');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture,
    outputDir: evidence,
    fakeBin: fakeDocker.bin,
  });
  const receiptFile = path.join(root, 'receipt-unknown.json');
  const receipt = createReceipt(evidence, receiptFile);
  assert(receipt.checkout.classification === 'UNTRACKED_UNKNOWN', 'unknown file classification expected');
  assert(receipt.checkout.unknown_untracked_path_hashes.length === 1, 'unknown file hash should be recorded');
  assert(!JSON.stringify(receipt).includes('mystery.txt'), 'unknown file name must not be persisted');
  nodeCliExpectFail(['receipt:verify', '--receipt-file', receiptFile, '--require-checkout-hygiene']);

  const operatorStateFixture = createFixture(root, { name: 'operator-state-unignored', operatorStateIgnored: false });
  const operatorStateEvidence = path.join(root, 'returned-operator-state-unignored');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture: operatorStateFixture,
    outputDir: operatorStateEvidence,
    fakeBin: fakeDocker.bin,
  });
  const operatorStateReceiptFile = path.join(root, 'receipt-operator-state-unignored.json');
  const operatorStateReceipt = createReceipt(operatorStateEvidence, operatorStateReceiptFile);
  assert(
    operatorStateReceipt.checkout.classification === 'ALLOWLISTED_EXTERNAL_STATE_UNTRACKED',
    'operator-state without ignore should not be treated as clean',
  );
  nodeCliExpectFail(['receipt:verify', '--receipt-file', operatorStateReceiptFile, '--require-checkout-hygiene']);

  const overbroadFixture = createFixture(root, { name: 'overbroad-ignore', overbroadIgnore: true });
  const overbroadEvidence = path.join(root, 'returned-overbroad');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture: overbroadFixture,
    outputDir: overbroadEvidence,
    fakeBin: fakeDocker.bin,
  });
  const overbroadReceiptFile = path.join(root, 'receipt-overbroad.json');
  const overbroadReceipt = createReceipt(overbroadEvidence, overbroadReceiptFile);
  assert(
    overbroadReceipt.checkout.ignore_policy.overbroad_source_ignore_detected === true,
    'overbroad source ignore should be detected',
  );
  nodeCliExpectFail(['receipt:verify', '--receipt-file', overbroadReceiptFile, '--require-checkout-hygiene']);
}

function testInvalidPreviousPointer(root, handoff, fakeDocker) {
  const fixture = createFixture(root, { name: 'bad-prev' });
  const pointerFile = path.join(root, 'bad-previous-pointer.env');
  writeText(pointerFile, `PREVIOUS_COMMIT=${fixture.previousCommit}\nUNKNOWN_KEY=value\n`);
  const evidence = path.join(root, 'returned-bad-prev');
  runCollector({
    collector: path.join(handoff, HANDOFF_COLLECTOR),
    fixture,
    outputDir: evidence,
    previousPointerFile: pointerFile,
    fakeBin: fakeDocker.bin,
  });
  const receiptFile = path.join(root, 'receipt-bad-prev.json');
  const receipt = createReceipt(evidence, receiptFile);
  assert(receipt.outcome === 'BLOCKED', 'invalid previous pointer should block complete acceptance');
  assert(receipt.previous_pointer.status === 'BLOCKED', 'invalid previous pointer should be blocked');
  nodeCliExpectFail(['receipt:verify', '--receipt-file', receiptFile, '--require-complete-previous-pointer']);
}

function testForbiddenCollectorScan(root) {
  const badHandoff = path.join(root, 'bad-handoff');
  nodeCli(['handoff', '--output-dir', badHandoff]);
  appendText(path.join(badHandoff, HANDOFF_COLLECTOR), '\ngit reset --hard\n');
  rewriteChecksums(badHandoff);
  const output = nodeCliExpectFail(['handoff:verify', '--handoff-dir', badHandoff]);
  assert(output.includes('forbidden operation'), 'forbidden collector command should be rejected');
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms019d-checkout-pointer-'));
  let passed = false;
  try {
    const handoff = testHandoffGeneration(root);
    const fakeDocker = createFakeDocker(root);
    testNoPreviousPointer(root, handoff, fakeDocker);
    testCompletePreviousPointer(root, handoff, fakeDocker);
    testDirtyCheckoutClassifications(root, handoff, fakeDocker);
    testInvalidPreviousPointer(root, handoff, fakeDocker);
    testForbiddenCollectorScan(root);
    console.log('production-checkout-pointer-evidence tests passed');
    passed = true;
  } finally {
    if (passed || process.env.MS019D_KEEP_TMP !== '1') {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.error(`Preserved failed test root: ${root}`);
    }
  }
}

main();
