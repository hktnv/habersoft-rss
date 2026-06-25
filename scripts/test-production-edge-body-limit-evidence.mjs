#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedPayload, verifyApplicationContract } from './production-edge-body-limit-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'scripts', 'production-edge-body-limit-evidence.mjs');
const HANDOFF_COLLECTOR = 'collect-production-edge-body-limit-evidence.sh';
const EXPECTED_FILES = ['checksums.sha256', 'collector-metadata.txt', 'evidence-records.tsv'];
const LIMIT_BYTES = 5 * 1024 * 1024;

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
    fail(`Command failed: ${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
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
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
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

function writeText(file, value, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { encoding: 'utf8', mode });
  if (process.platform !== 'win32') {
    fs.chmodSync(file, mode);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function windowsPathCandidates(nativePath) {
  const normalized = nativePath.replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/u);
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
  for (const candidate of windowsPathCandidates(path.resolve(nativePath))) {
    const result = spawnSync('bash.exe', ['-lc', `test -e ${shellQuote(candidate)}`], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status === 0) {
      bashPathCache.set(nativePath, candidate);
      return candidate;
    }
  }
  const fallback = windowsPathCandidates(path.resolve(nativePath))[0];
  bashPathCache.set(nativePath, fallback);
  return fallback;
}

function bashRun(command, env = {}) {
  const executable = process.platform === 'win32' ? 'bash.exe' : 'bash';
  return run(executable, ['-lc', command], {
    env: {
      ...process.env,
      ...env,
    },
  });
}

function rewriteHandoffChecksums(handoffDir) {
  const files = ['README.md', HANDOFF_COLLECTOR, 'edge-body-limit-contract.json', 'manifest.json'];
  const manifestFile = path.join(handoffDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.collector.sha256 = sha256File(path.join(handoffDir, HANDOFF_COLLECTOR));
  manifest.contract.sha256 = sha256File(path.join(handoffDir, 'edge-body-limit-contract.json'));
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeText(
    path.join(handoffDir, 'checksums.sha256'),
    `${files.map((file) => `${sha256File(path.join(handoffDir, file))}  ${file}`).join('\n')}\n`,
  );
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function createFakeCurl(root) {
  const bin = path.join(root, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const curl = path.join(bin, 'curl');
  writeText(
    curl,
    `#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$1" != "-q" ]; then
  exit 88
fi

mode="\${MS019E_FAKE_CURL_MODE:-success}"
output_file=""
payload_file=""
url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -q|--silent|--show-error)
      shift
      ;;
    --output|--write-out|--request|--connect-timeout|--max-time|--header|--user-agent)
      [ "$#" -ge 2 ] || exit 87
      if [ "$1" = "--output" ]; then
        output_file="$2"
      fi
      shift 2
      ;;
    --data-binary)
      [ "$#" -ge 2 ] || exit 87
      payload_file="\${2#@}"
      shift 2
      ;;
    http://*|https://*)
      url="$1"
      shift
      ;;
    *)
      exit 86
      ;;
  esac
done

[ -n "$output_file" ] || exit 85
[ -n "$payload_file" ] || exit 85
[ -n "$url" ] || exit 85

bytes=$(wc -c <"$payload_file" | tr -d ' ')
target="INTERNAL_LOOPBACK"
case "$url" in
  https://rss.habersoft.com/*) target="PUBLIC_HTTPS" ;;
  http://127.0.0.1:3200/*) target="INTERNAL_LOOPBACK" ;;
  *) exit 84 ;;
esac

status="401"
if [ "$bytes" = "5242881" ]; then
  status="413"
fi
uploaded="$bytes"
ssl="0"
exit_code="0"

case "$mode:$target:$bytes" in
  edge_low:PUBLIC_HTTPS:5242880)
    status="413"
    ;;
  connection_close:PUBLIC_HTTPS:5242880)
    status="000"
    exit_code="52"
    ;;
  short_upload:PUBLIC_HTTPS:5242880)
    uploaded="5242879"
    ;;
  tls_fail:PUBLIC_HTTPS:5242880)
    status="000"
    ssl="60"
    exit_code="60"
    ;;
  internal_control_fail:INTERNAL_LOOPBACK:1024)
    status="500"
    ;;
  public_control_fail:PUBLIC_HTTPS:1024)
    status="503"
    ;;
  status_mismatch:PUBLIC_HTTPS:5242881)
    status="200"
    ;;
esac

printf '{}' >"$output_file"
printf '%s\\t%s\\t%s\\t1.1' "$status" "$uploaded" "$ssl"
exit "$exit_code"
`,
    0o755,
  );
  bashRun(`chmod +x ${shellQuote(bashPath(curl))}`);
  return { bin };
}

function runCollector(handoffDir, outputDir, fakeCurl, mode = 'success') {
  const collector = path.join(handoffDir, HANDOFF_COLLECTOR);
  const command = [
    `export PATH=${shellQuote(bashPath(fakeCurl.bin))}:"$PATH";`,
    `export MS019E_FAKE_CURL_MODE=${shellQuote(mode)};`,
    `bash ${shellQuote(bashPath(collector))}`,
    '--confirm-public-host rss.habersoft.com',
    `--output-dir ${shellQuote(bashPath(outputDir))}`,
  ].join(' ');
  bashRun(command);
}

function parseMetadata(file) {
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .trim()
      .split(/\n/u)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function createAndVerifyReceipt(root, evidenceDir, name, strict = false) {
  const receipt = path.join(root, `${name}.json`);
  nodeCli(['receipt:create', '--evidence-dir', evidenceDir, '--output-file', receipt]);
  const args = ['receipt:verify', '--receipt-file', receipt];
  if (strict) {
    args.push('--require-edge-body-limit-compatibility');
  }
  nodeCli(args);
  return JSON.parse(fs.readFileSync(receipt, 'utf8'));
}

function assertEvidenceInventory(outputDir) {
  const files = fs.readdirSync(outputDir).sort();
  assert(JSON.stringify(files) === JSON.stringify([...EXPECTED_FILES].sort()), 'collector output inventory mismatch');
  const metadata = parseMetadata(path.join(outputDir, 'collector-metadata.txt'));
  assert(metadata.actual_request_count === '6', 'success fixture should execute six requests');
  assert(metadata.payload_retained === 'false', 'payload retention flag mismatch');
  assert(metadata.response_retained === 'false', 'response retention flag mismatch');
  assert(metadata.headers_retained === 'false', 'header retention flag mismatch');
  assert(!files.some((file) => /payload|body|header|log/iu.test(file)), 'collector retained forbidden artifact');
}

function testPayloads() {
  for (const size of [1024, LIMIT_BYTES, LIMIT_BYTES + 1]) {
    const payload = expectedPayload(size);
    const expectedProbeLength = size - Buffer.byteLength('{"probe":"') - Buffer.byteLength('"}');
    assert(Buffer.byteLength(payload, 'utf8') === size, `payload size mismatch ${size}`);
    assert(JSON.parse(payload).probe === 'a'.repeat(expectedProbeLength), 'payload JSON mismatch');
    assert(/^[\x20-\x7e]+$/u.test(payload), 'payload must be printable ASCII');
  }
}

function testHandoffAndSuccess(root) {
  verifyApplicationContract();
  nodeCli(['contract:verify']);
  const handoff = path.join(root, 'handoff');
  nodeCli(['handoff', '--output-dir', handoff]);
  nodeCli(['handoff:verify', '--handoff-dir', handoff]);
  const freeze = path.join(root, 'freeze.json');
  nodeCli(['handoff:freeze', '--handoff-dir', handoff, '--freeze-file', freeze, '--fixture-result', 'PASSED']);
  const freezeJson = JSON.parse(fs.readFileSync(freeze, 'utf8'));
  assert(freezeJson.generated_handoff_fixture_result === 'PASSED', 'freeze must bind fixture result');

  const fakeCurl = createFakeCurl(root);
  const evidence = path.join(root, 'returned-success');
  runCollector(handoff, evidence, fakeCurl, 'success');
  assertEvidenceInventory(evidence);
  const receipt = createAndVerifyReceipt(root, evidence, 'receipt-success', true);
  assert(receipt.outcome === 'SUCCESS', `success fixture receipt outcome mismatch: ${receipt.outcome}`);
  return { handoff, fakeCurl };
}

function testNegativeOutcomes(root, handoff, fakeCurl) {
  const cases = [
    ['edge_low', 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW'],
    ['connection_close', 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW'],
    ['short_upload', 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW'],
    ['tls_fail', 'BLOCKED_TLS'],
    ['internal_control_fail', 'BLOCKED_APPLICATION_BODY_LIMIT_BASELINE'],
    ['public_control_fail', 'BLOCKED_PUBLIC_EDGE_UNAVAILABLE'],
    ['status_mismatch', 'BLOCKED_EDGE_BODY_LIMIT_TOO_LOW'],
  ];
  for (const [mode, outcome] of cases) {
    const evidence = path.join(root, `returned-${mode}`);
    runCollector(handoff, evidence, fakeCurl, mode);
    const receipt = createAndVerifyReceipt(root, evidence, `receipt-${mode}`);
    assert(receipt.outcome === outcome, `${mode} should produce ${outcome}, got ${receipt.outcome}`);
    nodeCliExpectFail([
      'receipt:verify',
      '--receipt-file',
      path.join(root, `receipt-${mode}.json`),
      '--require-edge-body-limit-compatibility',
    ]);
  }
}

function testStaticSafety(root, handoff) {
  const badHandoff = path.join(root, 'bad-handoff');
  copyDir(handoff, badHandoff);
  fs.appendFileSync(path.join(badHandoff, HANDOFF_COLLECTOR), '\n# forbidden fixture\ncurl --insecure https://rss.habersoft.com/\n');
  rewriteHandoffChecksums(badHandoff);
  const output = nodeCliExpectFail(['handoff:verify', '--handoff-dir', badHandoff]);
  assert(output.includes('forbidden pattern') || output.includes('TLS bypass'), 'forbidden collector edit should be rejected');

  const crlfHandoff = path.join(root, 'crlf-handoff');
  copyDir(handoff, crlfHandoff);
  const collectorFile = path.join(crlfHandoff, HANDOFF_COLLECTOR);
  fs.writeFileSync(collectorFile, fs.readFileSync(collectorFile, 'utf8').replace(/\n/gu, '\r\n'), 'utf8');
  rewriteHandoffChecksums(crlfHandoff);
  nodeCliExpectFail(['handoff:verify', '--handoff-dir', crlfHandoff]);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms019e-edge-body-limit-'));
  let passed = false;
  try {
    testPayloads();
    const { handoff, fakeCurl } = testHandoffAndSuccess(root);
    testNegativeOutcomes(root, handoff, fakeCurl);
    testStaticSafety(root, handoff);
    console.log('production-edge-body-limit-evidence tests passed');
    passed = true;
  } finally {
    if (passed || process.env.MS019E_KEEP_TMP !== '1') {
      fs.rmSync(root, { recursive: true, force: true });
    } else {
      console.error(`Preserved failed test root: ${root}`);
    }
  }
}

main();
