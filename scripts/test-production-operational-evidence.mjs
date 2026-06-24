import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EXPECTED_MIGRATIONS, EXPECTED_SERVICES, RELEASE_IDENTITY } from "./release-identity.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-production-evidence-tests-"));
const checksumFiles = [
  "README.md",
  "collect-production-operational-evidence.sh",
  "evidence-contract.json",
  "manifest.json"
];
const payloadFiles = [
  "README.md",
  "collect-production-operational-evidence.sh",
  "evidence-contract.json"
];
const canonicalRemote = "https://github.com/hktnv/habersoft-rss";
const canonicalRemoteDotGit = `${canonicalRemote}.git`;
const rejectedCanonicalRemoteFixtures = Object.freeze([
  ["http", "http://github.com/hktnv/habersoft-rss"],
  ["git-protocol", "git://github.com/hktnv/habersoft-rss.git"],
  ["ssh-url", "ssh://git@github.com/hktnv/habersoft-rss.git"],
  ["scp-like", "git@github.com:hktnv/habersoft-rss.git"],
  ["wrong-host", "https://github.example/hktnv/habersoft-rss.git"],
  ["wrong-owner", "https://github.com/other/habersoft-rss.git"],
  ["wrong-repo", "https://github.com/hktnv/other.git"],
  ["double-suffix", "https://github.com/hktnv/habersoft-rss.git.git"],
  ["trailing-slash", "https://github.com/hktnv/habersoft-rss/"],
  ["dot-git-trailing-slash", "https://github.com/hktnv/habersoft-rss.git/"],
  ["subpath", "https://github.com/hktnv/habersoft-rss/subpath"],
  ["dot-git-subpath", "https://github.com/hktnv/habersoft-rss.git/subpath"],
  ["query", "https://github.com/hktnv/habersoft-rss?x=1"],
  ["fragment", "https://github.com/hktnv/habersoft-rss.git#fragment"],
  ["userinfo", "https://user@github.com/hktnv/habersoft-rss.git"],
  ["userinfo-password", "https://user:pass@github.com/hktnv/habersoft-rss.git"],
  ["explicit-port", "https://github.com:443/hktnv/habersoft-rss.git"],
  ["encoded-owner", "https://github.com/hkt%6ev/habersoft-rss.git"],
  ["encoded-repo", "https://github.com/hktnv/habersoft%2drss.git"],
  ["leading-space", " https://github.com/hktnv/habersoft-rss.git"],
  ["trailing-space", "https://github.com/hktnv/habersoft-rss.git "],
  ["empty", ""],
  ["not-recorded", "NOT_RECORDED"],
  ["prefix-repo", "https://github.com/hktnv/habersoft-rss-evil.git"]
]);

try {
  const validHandoff = generateHandoff("valid-handoff");
  assertVerifyHandoffPasses(validHandoff);
  const manifest = readJson(path.join(validHandoff, "manifest.json"));
  assert.equal(manifest.application_version, RELEASE_IDENTITY.version);
  assert.equal(manifest.application_status, RELEASE_IDENTITY.status);
  assert.equal(manifest.evidence_collected, false);
  assert.equal(manifest.production_contact_performed, false);
  assert.equal(manifest.production_mutation_performed, false);
  assert.deepEqual(manifest.expected_service_inventory, EXPECTED_SERVICES);
  assertLfOnly(path.join(validHandoff, "collect-production-operational-evidence.sh"), "generated handoff collector");
  assertRepositoryHygienePasses();

  const insideRepo = path.resolve(".tmp-production-evidence-handoff-inside");
  assert.equal(runNode(["scripts/production-operational-evidence.mjs", "handoff", "--output", insideRepo]).status, 1);
  assert.equal(existsSync(insideRepo), false);

  const nonEmpty = path.join(temp, "non-empty");
  mkdirSync(nonEmpty);
  writeFileSync(path.join(nonEmpty, "foreign.txt"), "foreign\n");
  assert.notEqual(runNode(["scripts/production-operational-evidence.mjs", "handoff", "--output", nonEmpty]).status, 0);

  const checksumTamper = generateHandoff("checksum-tamper");
  writeFileSync(path.join(checksumTamper, "README.md"), "tampered\n");
  assertVerifyHandoffFails(checksumTamper, /checksum mismatch/u);

  const unknownFile = generateHandoff("unknown-file");
  writeFileSync(path.join(unknownFile, "extra.txt"), "unexpected\n");
  assertVerifyHandoffFails(unknownFile, /file inventory/u);

  const symlinkBundle = generateHandoff("symlink");
  const readme = path.join(symlinkBundle, "README.md");
  const target = path.join(temp, "symlink-target.txt");
  writeFileSync(target, "outside\n");
  rmSync(readme);
  let symlinkTested = false;
  try {
    symlinkSync(target, readme, "file");
    symlinkTested = true;
    assertVerifyHandoffFails(symlinkBundle, /symlink/u);
  } catch {
    writeFileSync(readme, "restored\n");
    refreshHandoff(symlinkBundle);
    const checksums = readFileSync(path.join(symlinkBundle, "checksums.sha256"), "utf8");
    writeFileSync(path.join(symlinkBundle, "checksums.sha256"), `${checksums}${"a".repeat(64)}  ../escape\n`);
    assertVerifyHandoffFails(symlinkBundle, /checksum path|checksum inventory|malformed/u);
  }

  const secretBundle = generateHandoff("secret");
  appendText(secretBundle, "README.md", "\nDATABASE_URL=postgresql://user:password@example.test/db\n");
  refreshHandoff(secretBundle);
  assertVerifyHandoffFails(secretBundle, /secret\/privacy pattern/u);

  const inspectEnvBundle = generateHandoff("inspect-env");
  appendText(inspectEnvBundle, "collect-production-operational-evidence.sh", "\ndocker inspect --format '{{json .Config.Env}}' example\n");
  refreshHandoff(inspectEnvBundle);
  assertVerifyHandoffFails(inspectEnvBundle, /secret\/privacy pattern|forbidden command/u);

  const forbiddenCommandBundle = generateHandoff("forbidden-command");
  appendText(forbiddenCommandBundle, "collect-production-operational-evidence.sh", "\ngit pull\n");
  refreshHandoff(forbiddenCommandBundle);
  assertVerifyHandoffFails(forbiddenCommandBundle, /forbidden command/u);

  const falseClaimBundle = generateHandoff("false-claim");
  const falseManifest = readJson(path.join(falseClaimBundle, "manifest.json"));
  falseManifest.safety_flags.deployment_performed = true;
  falseManifest.deployment_performed = true;
  writeJson(path.join(falseClaimBundle, "manifest.json"), falseManifest);
  refreshHandoff(falseClaimBundle);
  assertVerifyHandoffFails(falseClaimBundle, /must be false/u);

  const crlfCollectorBundle = generateHandoff("crlf-collector");
  const crlfCollector = path.join(crlfCollectorBundle, "collect-production-operational-evidence.sh");
  writeFileSync(crlfCollector, readFileSync(crlfCollector, "utf8").replace(/\n/gu, "\r\n"));
  refreshHandoff(crlfCollectorBundle);
  assertVerifyHandoffFails(crlfCollectorBundle, /LF line endings/u);

  assertRepositoryHygieneFixtureFails("missing-attribute", { omitAttributes: true }, /missing .*LF rule|required file missing/u);
  assertRepositoryHygieneFixtureFails("crlf-tracked-collector", { collectorCrlf: true }, /collector.*CR byte/u);
  assertRepositoryHygieneFixtureFails("crlf-handoff-collector", { handoffCollectorCrlf: true }, /generated handoff collector.*CR byte/u);
  assertRepositoryHygieneFixtureFails("mirror-mismatch", { mirrorMismatch: true }, /operator mirror PRODUCTION\.md SHA-256/u);

  const collectorText = readFileSync("scripts/production-operational-evidence-collector.sh", "utf8");
  assert.doesNotMatch(collectorText, /\bset\s+-x\b/u);
  assert.doesNotMatch(collectorText, /\bgit\s+(?:fetch|pull|switch|checkout|reset|clean)\b/u);
  assert.doesNotMatch(collectorText, /\bdocker\s+compose\s+(?:up|down|restart|stop|rm|run|create)\b/u);
  assert.match(collectorText, /docker compose --env-file "\$SHARED_ENV_FILE" --env-file "\$IMAGE_ENV_FILE" -f "\$COMPOSE_FILE" "\$@"/u);
  assert.doesNotMatch(collectorText, /\bdocker compose (?!--env-file "\$SHARED_ENV_FILE" --env-file "\$IMAGE_ENV_FILE" -f "\$COMPOSE_FILE")/u);
  assert.match(collectorText, /compose_cmd config --services/u);
  assert.match(collectorText, /"migration.result" "NOT_RUN"/u);
  assert.match(collectorText, /"worker_scheduler.worker_health" "NOT_RUN"/u);
  assert.doesNotMatch(collectorText, /\.Config\.Env/u);
  assertLfOnly("scripts/production-operational-evidence-collector.sh", "tracked collector");
  const bashCheck = spawnSync("bash", ["-n", "scripts/production-operational-evidence-collector.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
  if (bashCheck.error === undefined && bashCheck.status !== null) {
    assert.equal(bashCheck.status, 0, bashCheck.stderr);
  }
  assertCollectorComposeContextPasses("dot-git", canonicalRemoteDotGit);
  assertCollectorComposeContextPasses("suffixless", canonicalRemote);
  assertCollectorComposeContextBlocks();

  const completeReceipt = createCompleteReceipt();
  const completeReceiptFile = writeReceipt("complete-receipt.json", completeReceipt);
  assertVerifyReceiptPasses(completeReceiptFile);
  assertVerifyReceiptPasses(completeReceiptFile, true);

  const evidenceDir = writeEvidenceBundle("complete-evidence", completeReceipt);
  const createdReceiptFile = path.join(temp, "created-operational-receipt.json");
  const createResult = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:create",
    "--evidence",
    evidenceDir,
    "--output",
    createdReceiptFile
  ]);
  assert.equal(createResult.status, 0, createResult.stderr);
  const createdReceipt = readJson(createdReceiptFile);
  assert.equal(createdReceipt.identity.canonical_remote, canonicalRemote);
  assert.equal(createdReceipt.identity.running_image_source_label, canonicalRemote);
  assertVerifyReceiptPasses(createdReceiptFile);

  const dotGitReceipt = createCompleteReceipt({
    identity: {
      canonical_remote: canonicalRemoteDotGit,
      running_image_source_label: canonicalRemoteDotGit
    }
  });
  const dotGitReceiptFile = writeReceipt("dot-git-receipt.json", dotGitReceipt);
  assertVerifyReceiptPasses(dotGitReceiptFile);
  const dotGitEvidenceDir = writeEvidenceBundle("dot-git-evidence", dotGitReceipt);
  const dotGitCreatedReceiptFile = path.join(temp, "dot-git-created-operational-receipt.json");
  const dotGitCreateResult = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:create",
    "--evidence",
    dotGitEvidenceDir,
    "--output",
    dotGitCreatedReceiptFile
  ]);
  assert.equal(dotGitCreateResult.status, 0, dotGitCreateResult.stderr);
  const dotGitCreatedReceipt = readJson(dotGitCreatedReceiptFile);
  assert.equal(dotGitCreatedReceipt.identity.canonical_remote, canonicalRemote);
  assert.equal(dotGitCreatedReceipt.identity.running_image_source_label, canonicalRemote);
  assertVerifyReceiptPasses(dotGitCreatedReceiptFile);

  const partialReceipt = createCompleteReceipt({
    operational_baseline: "PARTIAL",
    identity: {
      running_image_revision_label: "NOT_RECORDED",
      running_image_source_label: "NOT_RECORDED",
      server_checkout_matches_running_revision: false,
      runtime_revision_known_in_canonical_repo: false,
      runtime_revision_ancestor_of_verified_origin_main: false
    },
    tls: {
      verification: "TOOL_UNAVAILABLE",
      fingerprint_sha256: "NOT_RECORDED",
      not_before: "NOT_RECORDED",
      not_after: "NOT_RECORDED",
      hostname_match: "NOT_RECORDED",
      tool_availability: "TOOL_UNAVAILABLE"
    },
    pointers: {
      previous_commit: "NOT_RECORDED",
      previous_image_id: "NOT_RECORDED"
    }
  });
  const partialReceiptFile = writeReceipt("partial-receipt.json", partialReceipt);
  assertVerifyReceiptPasses(partialReceiptFile);
  assertVerifyReceiptFails(partialReceiptFile, /operational baseline is not passed/u, true);

  for (const [label, remote] of rejectedCanonicalRemoteFixtures) {
    assertReceiptMutationFails(`canonical-remote-${label}`, (receipt) => {
      receipt.identity.canonical_remote = remote;
    }, /canonical_remote/u);
  }
  assertReceiptMutationFails("canonical-remote-missing", (receipt) => {
    delete receipt.identity.canonical_remote;
  }, /identity/u);
  assertReceiptMutationFails("running-image-source-dot-git-subpath", (receipt) => {
    receipt.identity.running_image_source_label = "https://github.com/hktnv/habersoft-rss.git/subpath";
  }, /running_image_source_label/u);
  const notRecordedEvidenceDir = writeEvidenceBundle(
    "not-recorded-remote-evidence",
    createCompleteReceipt({
      identity: {
        canonical_remote: "NOT_RECORDED"
      }
    })
  );
  const notRecordedCreateResult = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:create",
    "--evidence",
    notRecordedEvidenceDir,
    "--output",
    path.join(temp, "not-recorded-remote-receipt.json")
  ]);
  assert.notEqual(notRecordedCreateResult.status, 0);
  assert.match(notRecordedCreateResult.stderr, /canonical_remote/u);

  assertReceiptMutationFails("malformed-git", (receipt) => {
    receipt.identity.server_checkout_commit = "abc";
  }, /server_checkout_commit malformed/u);
  assertReceiptMutationFails("malformed-image", (receipt) => {
    receipt.identity.api_running_image_id = "sha256:abc";
  }, /api_running_image_id malformed/u);
  assertReceiptMutationFails("runtime-api-image-mismatch", (receipt) => {
    receipt.identity.api_running_image_id = imageId("2");
  }, /image mismatch/u);
  assertReceiptMutationFails("api-worker-image-mismatch", (receipt) => {
    receipt.identity.worker_running_image_id = imageId("3");
  }, /image mismatch/u);
  assertReceiptMutationFails("inspected-image-mismatch", (receipt) => {
    receipt.identity.inspected_image_id = imageId("4");
  }, /image mismatch/u);
  assertReceiptMutationFails("wrong-source", (receipt) => {
    receipt.identity.running_image_source_label = "https://example.invalid/repo";
  }, /running_image_source_label|wrong canonical remote/u);
  assertReceiptMutationFails("unknown-revision", (receipt) => {
    receipt.identity.running_image_revision_label = "f".repeat(40);
  }, /not in canonical history/u);
  assertReceiptMutationFails("postgres-port", (receipt) => {
    receipt.services.public_database_port_absent = "FAILED";
  }, /PostgreSQL host port/u);
  assertReceiptMutationFails("redis-port", (receipt) => {
    receipt.services.public_redis_port_absent = "FAILED";
  }, /Redis host port/u);
  assertReceiptMutationFails("worker-port", (receipt) => {
    receipt.services.worker_host_port_absent = "FAILED";
  }, /worker host port/u);
  assertReceiptMutationFails("api-public-bind", (receipt) => {
    receipt.services.api_loopback_binding.host_ip = "0.0.0.0";
  }, /loopback-only/u);
  assertReceiptMutationFails("missing-service", (receipt) => {
    delete receipt.services.observed_service_states.redis;
  }, /missing expected service/u);
  assertReceiptMutationFails("unexpected-service", (receipt) => {
    receipt.services.unexpected_services = ["debug-dashboard"];
  }, /unexpected production service/u);
  assertReceiptMutationFails("migrate-running", (receipt) => {
    receipt.services.observed_service_states.migrate.status = "running";
  }, /migrate must not be long-running/u);
  assertReceiptMutationFails("migration-pending", (receipt) => {
    receipt.migration.pending_or_failed = "FAILED";
  }, /pending\/failed/u);
  assertReceiptMutationFails("worker-failure", (receipt) => {
    receipt.worker_scheduler.worker_health = "FAILED";
  }, /worker health failed/u);
  assertReceiptMutationFails("scheduler-false-claim", (receipt) => {
    receipt.worker_scheduler.worker_health = "NOT_RECORDED";
  }, /direct scheduler evidence requires worker health/u);
  assertReceiptMutationFails("health-503", (receipt) => {
    receipt.health_boundary.public_ready.http_status = 503;
  }, /public_ready HTTP status/u);
  assertReceiptMutationFails("tenant-2xx", (receipt) => {
    receipt.health_boundary.tenant_unauth.http_status = 200;
  }, /tenant_unauth HTTP status|protected route returned/u);
  assertReceiptMutationFails("agent-2xx", (receipt) => {
    receipt.health_boundary.agent_unauth.http_status = 200;
  }, /agent_unauth HTTP status|protected route returned/u);
  assertReceiptMutationFails("unknown-2xx", (receipt) => {
    receipt.health_boundary.unknown_route.http_status = 200;
  }, /unknown_route HTTP status|unknown route returned/u);
  assertReceiptMutationFails("redirect-wrong", (receipt) => {
    receipt.health_boundary.http_to_https_redirect.location = "https://example.invalid/health/live";
  }, /redirect location/u);
  assertReceiptMutationFails("tls-failed", (receipt) => {
    receipt.tls.verification = "FAILED";
  }, /TLS verification failed/u);
  assertReceiptMutationFails("mutation-flag", (receipt) => {
    receipt.production_mutation_performed = true;
  }, /production_mutation_performed/u);
  assertReceiptMutationFails("publication-flag", (receipt) => {
    receipt.artifact_published = true;
  }, /artifact_published/u);
  assertReceiptMutationFails("private-path", (receipt) => {
    receipt.identity.local_origin_main_ref = "C:\\Users\\operator\\private";
  }, /local_origin_main_ref malformed|private|privacy/u);
  assertReceiptMutationFails("raw-log-body", (receipt) => {
    receipt.health_boundary.public_ready.raw_body = "raw_body";
  }, /field inventory|raw/i);

  console.log(`test-production-operational-evidence: ok${symlinkTested ? "" : " (symlink unavailable; traversal fallback covered)"}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function generateHandoff(label) {
  const outputDir = path.join(temp, label);
  const result = runNode(["scripts/production-operational-evidence.mjs", "handoff", "--output", outputDir]);
  assert.equal(result.status, 0, result.stderr);
  return outputDir;
}

function assertVerifyHandoffPasses(bundle) {
  const result = runNode(["scripts/production-operational-evidence.mjs", "handoff:verify", "--bundle", bundle]);
  assert.equal(result.status, 0, result.stderr);
}

function assertVerifyHandoffFails(bundle, pattern) {
  const result = runNode(["scripts/production-operational-evidence.mjs", "handoff:verify", "--bundle", bundle]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

function assertVerifyReceiptPasses(receipt, requireBaseline = false) {
  const result = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:verify",
    "--receipt",
    receipt,
    ...(requireBaseline ? ["--require-operational-baseline"] : [])
  ]);
  assert.equal(result.status, 0, result.stderr);
}

function assertVerifyReceiptFails(receipt, pattern, requireBaseline = false) {
  const result = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:verify",
    "--receipt",
    receipt,
    ...(requireBaseline ? ["--require-operational-baseline"] : [])
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

function assertRepositoryHygienePasses() {
  const result = runNode(["scripts/repository-hygiene-verify.mjs"]);
  assert.equal(result.status, 0, result.stderr);
}

function assertRepositoryHygieneFixtureFails(label, options, pattern) {
  const fixture = writeRepositoryHygieneFixture(label, options);
  const result = runNode([
    "scripts/repository-hygiene-verify.mjs",
    "--root",
    fixture.root,
    "--production-mirror",
    fixture.mirror,
    "--handoff",
    fixture.handoff
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

function assertCollectorComposeContextPasses(label, remote) {
  const fixture = writeCollectorFixture(`collector-${label}`, { remote });
  const outputDir = path.join(fixture.root, "collector-output");
  mkdirSync(outputDir);
  const result = runCollectorFixture(fixture, outputDir);
  assert.equal(result.status, 0, result.stderr);
  const records = readEvidenceRecords(outputDir);
  assert.equal(records.get("compose_context.result"), "PASSED", readFileSync(fixture.trace, "utf8"));
  assert.equal(records.get("compose_context.evidence_source"), "DIRECT_OBSERVED");
  assert.equal(records.get("identity.canonical_remote"), remote);
  assert.equal(records.get("services.observed_service_names"), "postgres,redis,migrate,main-service-api,main-service-worker");
  assert.equal(records.get("services.api_loopback_binding.result"), "PASSED");
  assert.equal(records.get("services.public_database_port_absent"), "PASSED");
  assert.equal(records.get("services.public_redis_port_absent"), "PASSED");
  assert.equal(records.get("services.worker_host_port_absent"), "PASSED");
  assert.equal(records.get("migration.result"), "PASSED");
  assert.equal(records.get("worker_scheduler.worker_health"), "PASSED");
  assert.equal(records.get("worker_scheduler.worker_health_evidence_source"), "DIRECT_OBSERVED");
  assert.equal(records.get("worker_scheduler.scheduler_evidence_source"), "DIRECT_OBSERVED");
  assert.equal(records.has("health_boundary.public_ready.http_status.result"), false);
  assert.equal(records.get("health_boundary.public_ready.result"), "PASSED");
  assertDockerTraceUsesProductionContext(fixture.trace);
  assertCollectorReceiptPasses(outputDir, {
    composeContext: "PASSED",
    migration: "PASSED",
    workerHealth: "PASSED"
  });
}

function assertCollectorComposeContextBlocks() {
  const fixture = writeCollectorFixture("collector-context-blocked", {
    remote: canonicalRemoteDotGit,
    composeFail: true
  });
  const outputDir = path.join(fixture.root, "collector-output");
  mkdirSync(outputDir);
  const result = runCollectorFixture(fixture, outputDir);
  assert.equal(result.status, 0, result.stderr);
  const records = readEvidenceRecords(outputDir);
  assert.equal(records.get("compose_context.result"), "BLOCKED");
  assert.equal(records.get("services.observed_service_names"), "NOT_RECORDED");
  assert.equal(records.get("migration.result"), "NOT_RUN");
  assert.equal(records.get("migration.evidence_source"), "BLOCKED");
  assert.equal(records.get("worker_scheduler.worker_health"), "NOT_RUN");
  assert.equal(records.get("worker_scheduler.worker_health_evidence_source"), "BLOCKED");
  assert.equal(records.get("worker_scheduler.scheduler_evidence_source"), "NOT_RUN");
  assert.doesNotMatch(readFileSync(path.join(outputDir, "evidence-records.tsv"), "utf8"), /DATABASE_URL|POSTGRES_PASSWORD|redacted compose context error/u);
  assertDockerTraceUsesProductionContext(fixture.trace);
  assertCollectorReceiptPasses(outputDir, {
    composeContext: "BLOCKED",
    migration: "NOT_RUN",
    workerHealth: "NOT_RUN"
  });
}

function assertCollectorReceiptPasses(outputDir, expected) {
  const receiptFile = path.join(path.dirname(outputDir), `${path.basename(outputDir)}-receipt.json`);
  const createResult = runNode([
    "scripts/production-operational-evidence.mjs",
    "receipt:create",
    "--evidence",
    outputDir,
    "--output",
    receiptFile
  ]);
  assert.equal(createResult.status, 0, createResult.stderr);
  const receipt = readJson(receiptFile);
  assert.equal(receipt.contract_version, "production-operational-evidence-v2");
  assert.equal(receipt.milestone, "MS-019B-R7");
  assert.equal(receipt.compose_context.result, expected.composeContext);
  assert.equal(receipt.migration.result, expected.migration);
  assert.equal(receipt.worker_scheduler.worker_health, expected.workerHealth);
  assertVerifyReceiptPasses(receiptFile);
}

function assertReceiptMutationFails(label, mutate, pattern) {
  const receipt = createCompleteReceipt();
  mutate(receipt);
  const file = writeReceipt(`${label}.json`, receipt);
  assertVerifyReceiptFails(file, pattern);
}

function createCompleteReceipt(overrides = {}) {
  const runtimeRevision = gitOutput(["rev-parse", "origin/main"]);
  const serverCheckout = gitOutput(["rev-parse", "HEAD"]);
  const currentImage = imageId("1");
  const receipt = {
    schema_version: 1,
    contract_version: "production-operational-evidence-v1",
    milestone: "MS-019A",
    service: "main-service",
    environment: "production",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    collected_at_utc: "2026-06-24T00:00:00Z",
    collector_source_commit: runtimeRevision,
    collector_sha256: "a".repeat(64),
    evidence_mode: "READ_ONLY",
    production_mutation_performed: false,
    deployment_performed: false,
    backup_performed: false,
    restore_performed: false,
    artifact_published: false,
    git_tag_created: false,
    github_release_created: false,
    operational_baseline: "PASSED",
    identity: {
      canonical_remote: canonicalRemote,
      server_checkout_commit: serverCheckout,
      server_checkout_clean: true,
      local_origin_main_ref: runtimeRevision,
      runtime_image_env_image_id: currentImage,
      api_running_image_id: currentImage,
      worker_running_image_id: currentImage,
      inspected_image_id: currentImage,
      running_image_revision_label: runtimeRevision,
      running_image_source_label: canonicalRemote,
      image_identity_consistent: true,
      server_checkout_matches_running_revision: serverCheckout === runtimeRevision,
      runtime_revision_known_in_canonical_repo: true,
      runtime_revision_ancestor_of_verified_origin_main: true
    },
    services: {
      expected_services: [...EXPECTED_SERVICES],
      observed_service_states: {
        postgres: serviceState("running", "healthy"),
        redis: serviceState("running", "healthy"),
        migrate: serviceState("exited", "not_applicable"),
        "main-service-api": serviceState("running", "healthy"),
        "main-service-worker": serviceState("running", "healthy")
      },
      unexpected_services: [],
      api_loopback_binding: {
        result: "PASSED",
        host_ip: "127.0.0.1",
        host_port: 3200,
        container_port: 3000
      },
      public_database_port_absent: "PASSED",
      public_redis_port_absent: "PASSED",
      worker_host_port_absent: "PASSED"
    },
    migration: {
      result: "PASSED",
      evidence_source: "DIRECT_OBSERVED",
      expected_migrations: [...EXPECTED_MIGRATIONS],
      pending_or_failed: "NOT_APPLICABLE",
      output_sha256: "b".repeat(64)
    },
    worker_scheduler: {
      worker_health: "PASSED",
      worker_health_evidence_source: "DIRECT_OBSERVED",
      queue: "main-service.maintenance",
      scheduler: "cleanup.daily",
      job: "cleanup.run.v1",
      timezone: "UTC",
      global_concurrency: 1,
      local_concurrency: 1,
      scheduler_evidence_source: "DIRECT_OBSERVED"
    },
    health_boundary: {
      internal_live: endpoint("http://127.0.0.1:3200/health/live", 200, "live"),
      internal_ready: endpoint("http://127.0.0.1:3200/health/ready", 200, "ready"),
      public_live: endpoint("https://rss.habersoft.com/health/live", 200, "live"),
      public_ready: endpoint("https://rss.habersoft.com/health/ready", 200, "ready"),
      postgres: "up",
      redis: "up",
      tenantAuth: "up",
      unknown_route: endpoint("https://rss.habersoft.com/not-found", 404, "NOT_APPLICABLE"),
      tenant_unauth: endpoint("https://rss.habersoft.com/api/feeds", 401, "NOT_APPLICABLE"),
      agent_unauth: endpoint("https://rss.habersoft.com/agent/feeds/due?limit=1", 401, "NOT_APPLICABLE"),
      http_to_https_redirect: {
        result: "PASSED",
        source_url: "http://rss.habersoft.com/health/live",
        location: "https://rss.habersoft.com/health/live"
      }
    },
    tls: {
      verification: "PASSED",
      fingerprint_sha256: "c".repeat(64),
      not_before: "2026-01-01T00:00:00Z",
      not_after: "2026-12-31T23:59:59Z",
      hostname_match: true,
      tool_availability: "PASSED"
    },
    pointers: {
      current_image_identity: currentImage,
      previous_commit: runtimeRevision,
      previous_image_id: imageId("5")
    },
    stability: {
      observation_kind: "POINT_IN_TIME_SNAPSHOT",
      api: {
        restart_count: 0,
        oom_killed: false,
        state: "running",
        started_at: "2026-06-24T00:00:00Z"
      },
      worker: {
        restart_count: 0,
        oom_killed: false,
        state: "running",
        started_at: "2026-06-24T00:00:00Z"
      },
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

  return deepMerge(receipt, overrides);
}

function serviceState(status, health) {
  return {
    status,
    health,
    restart_count: 0,
    oom_killed: false,
    started_at: "2026-06-24T00:00:00Z",
    image_id: imageId("1"),
    port_projection: "NOT_RECORDED"
  };
}

function endpoint(url, status, responseStatus) {
  return {
    result: "PASSED",
    method: "GET",
    url,
    http_status: status,
    expected_http_status: status,
    response_status: responseStatus
  };
}

function writeReceipt(name, receipt) {
  const file = path.join(temp, name);
  writeJson(file, receipt);
  return file;
}

function writeEvidenceBundle(label, receipt) {
  const dir = path.join(temp, label);
  mkdirSync(dir);
  const records = flatten(receipt)
    .map(([key, value]) => `${key}\t${encodeRecordValue(value)}`)
    .join("\n");
  writeFileSync(path.join(dir, "evidence-records.tsv"), `${records}\n`);
  writeFileSync(path.join(dir, "collector-metadata.txt"), "collector=production-operational-evidence\nmilestone=MS-019A\n");
  writeFileSync(
    path.join(dir, "checksums.sha256"),
    `${sha256(readFileSync(path.join(dir, "collector-metadata.txt")))}  collector-metadata.txt\n${sha256(readFileSync(path.join(dir, "evidence-records.tsv")))}  evidence-records.tsv\n`
  );
  return dir;
}

function writeCollectorFixture(label, options) {
  const root = path.join(temp, label);
  const backend = path.join(root, "repo");
  const deployProduction = path.join(backend, "deploy", "production");
  const deploy = path.join(backend, "deploy");
  const fakeBin = path.join(root, "fake-bin");
  const trace = path.join(root, "docker-trace.txt");
  mkdirSync(deployProduction, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(path.join(backend, "package.json"), "{}\n");
  writeFileSync(path.join(deployProduction, "compose.yaml"), "name: main-service-production\nservices:\n  postgres: {}\n  redis: {}\n  migrate: {}\n  main-service-api: {}\n  main-service-worker: {}\n");
  writeFileSync(path.join(backend, ".env.production"), "LOG_LEVEL=info\nAPI_HOST_PORT=3200\n");
  writeFileSync(path.join(deploy, "runtime-image.env"), `MAIN_SERVICE_IMAGE=${imageId("1")}\n`);
  runGit(["init"], backend);
  runGit(["config", "user.email", "fixture@example.invalid"], backend);
  runGit(["config", "user.name", "Fixture"], backend);
  runGit(["remote", "add", "origin", options.remote], backend);
  runGit(["add", "."], backend);
  runGit(["commit", "-m", "fixture"], backend);
  const revision = gitOutput(["rev-parse", "origin/main"]);
  writeFakeDocker(fakeBin, trace, revision);
  writeFakeCurl(fakeBin);
  writeFakeOpenSsl(fakeBin);
  return { root, backend, fakeBin, trace, composeFail: options.composeFail === true };
}

function runCollectorFixture(fixture, outputDir) {
  const fakeBin = toBashPath(fixture.fakeBin);
  const repositoryDir = toBashPath(fixture.backend);
  const collectorOutputDir = toBashPath(outputDir);
  const dockerTrace = toBashPath(fixture.trace);
  const composeFail = fixture.composeFail ? "1" : "0";
  const command = [
    `PATH=${shQuote(fakeBin)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    `DOCKER_TRACE=${shQuote(dockerTrace)}`,
    `COLLECTOR_FIXTURE_COMPOSE_FAIL=${shQuote(composeFail)}`,
    "exec bash scripts/production-operational-evidence-collector.sh",
    `--repository-dir ${shQuote(repositoryDir)}`,
    "--compose-file deploy/production/compose.yaml",
    "--shared-env .env.production",
    "--runtime-image-env deploy/runtime-image.env",
    `--output-dir ${shQuote(collectorOutputDir)}`,
    "--public-base-url https://rss.habersoft.com",
    "--api-loopback-base-url http://127.0.0.1:3200"
  ].join(" ");
  return spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    env: process.env
  });
}

function writeFakeDocker(fakeBin, trace, revision) {
  writeExecutable(path.join(fakeBin, "docker"), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "\${DOCKER_TRACE}"
image_id='${imageId("1")}'
revision='${revision}'
case "$*" in
  compose*"config --services"*)
    if [ "\${COLLECTOR_FIXTURE_COMPOSE_FAIL:-0}" = "1" ]; then
      printf '%s\\n' "redacted compose context error" >&2
      exit 1
    fi
    printf '%s\\n' postgres redis migrate main-service-api main-service-worker
    exit 0
    ;;
  compose*"ps --services"*)
    printf '%s\\n' postgres redis migrate main-service-api main-service-worker
    exit 0
    ;;
  compose*"ps -q postgres"*) printf '%s\\n' cid-postgres; exit 0 ;;
  compose*"ps -q redis"*) printf '%s\\n' cid-redis; exit 0 ;;
  compose*"ps -q migrate"*) printf '%s\\n' cid-migrate; exit 0 ;;
  compose*"ps -q main-service-api"*) printf '%s\\n' cid-api; exit 0 ;;
  compose*"ps -q main-service-worker"*) printf '%s\\n' cid-worker; exit 0 ;;
  compose*"exec -T main-service-api npm run migrate:status"*)
    printf '%s\\n' "Database schema is up to date"
    exit 0
    ;;
  compose*"exec -T main-service-worker npm run worker:health"*)
    printf '%s\\n' '{"queue":"main-service.maintenance","scheduler_id":"cleanup.daily"}'
    exit 0
    ;;
esac
if [ "\${1:-}" = "image" ] && [ "\${2:-}" = "inspect" ]; then
  case "$*" in
    *".Id"*) printf '%s\\n' "$image_id" ;;
    *"org.opencontainers.image.revision"*) printf '%s\\n' "$revision" ;;
    *"org.opencontainers.image.source"*) printf '%s\\n' '${canonicalRemote}' ;;
    *) printf '%s\\n' "NOT_RECORDED" ;;
  esac
  exit 0
fi
if [ "\${1:-}" = "inspect" ]; then
  cid=\${4:-}
  case "$*" in
    *".State.Status"*)
      if [ "$cid" = "cid-migrate" ]; then printf '%s\\n' exited; else printf '%s\\n' running; fi
      ;;
    *".State.Health"*)
      if [ "$cid" = "cid-migrate" ]; then printf '%s\\n' not_applicable; else printf '%s\\n' healthy; fi
      ;;
    *".RestartCount"*) printf '%s\\n' 0 ;;
    *".State.OOMKilled"*) printf '%s\\n' false ;;
    *".State.StartedAt"*) printf '%s\\n' "2026-06-24T00:00:00Z" ;;
    *".Image"*) printf '%s\\n' "$image_id" ;;
    *"NetworkSettings.Ports"*)
      if [ "$cid" = "cid-api" ]; then printf '%s\\n' "3000/tcp=127.0.0.1:3200,"; else printf '%s\\n' ""; fi
      ;;
    *) printf '%s\\n' "NOT_RECORDED" ;;
  esac
  exit 0
fi
printf '%s\\n' "unsupported docker fixture command" >&2
exit 1
`);
}

function writeFakeCurl(fakeBin) {
  writeExecutable(path.join(fakeBin, "curl"), `#!/usr/bin/env bash
set -eu
out=
dump=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) out=$2; shift 2 ;;
    --dump-header) dump=$2; shift 2 ;;
    --write-out) shift 2 ;;
    --*) shift ;;
    *) url=$1; shift ;;
  esac
done
if [ -n "$dump" ]; then
  printf '%s\\n' "location: https://rss.habersoft.com/health/live" > "$dump"
  printf '%s' "301"
  exit 0
fi
case "$url" in
  *"/health/live"*) [ -n "$out" ] && printf '%s\\n' '{"status":"live"}' > "$out"; printf '%s' "200" ;;
  *"/health/ready"*) [ -n "$out" ] && printf '%s\\n' '{"status":"ready","dependencies":{"postgres":"up","redis":"up","tenantAuth":"up"}}' > "$out"; printf '%s' "200" ;;
  *"/not-found"*) [ -n "$out" ] && printf '%s\\n' '{}' > "$out"; printf '%s' "404" ;;
  *"/api/feeds"*) [ -n "$out" ] && printf '%s\\n' '{}' > "$out"; printf '%s' "401" ;;
  *"/agent/feeds/due"*) [ -n "$out" ] && printf '%s\\n' '{}' > "$out"; printf '%s' "401" ;;
  *) [ -n "$out" ] && printf '%s\\n' '{}' > "$out"; printf '%s' "000" ;;
esac
`);
}

function writeFakeOpenSsl(fakeBin) {
  writeExecutable(path.join(fakeBin, "openssl"), `#!/usr/bin/env bash
set -eu
if [ "\${1:-}" = "x509" ]; then
  printf '%s\\n' "sha256 Fingerprint=CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC:CC"
  printf '%s\\n' "notBefore=Jan  1 00:00:00 2026 GMT"
  printf '%s\\n' "notAfter=Dec 31 23:59:59 2026 GMT"
  exit 0
fi
printf '%s\\n' "CERT"
`);
}

function writeExecutable(file, text) {
  writeFileSync(file, text.replace(/\r\n/gu, "\n"));
  try {
    spawnSync("chmod", ["755", file], { shell: false });
  } catch {
    // chmod is unavailable on some Windows shells; bash can still execute via explicit interpreter.
  }
}

function readEvidenceRecords(outputDir) {
  return new Map(readFileSync(path.join(outputDir, "evidence-records.tsv"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => {
      const [key, ...rest] = line.split("\t");
      return [key, rest.join("\t")];
    }));
}

function assertDockerTraceUsesProductionContext(traceFile) {
  const trace = readFileSync(traceFile, "utf8");
  assert.match(trace, /--env-file .*\.env\.production --env-file .*deploy\/runtime-image\.env -f .*deploy\/production\/compose\.yaml/u);
  assert.doesNotMatch(trace, /\bdocker compose\b/u);
}

function toBashPath(file) {
  const resolved = path.resolve(file);
  const driveMatch = /^([A-Za-z]):\\(.*)$/u.exec(resolved);
  if (driveMatch !== null) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replaceAll("\\", "/")}`;
  }
  return resolved.replaceAll(path.sep, "/");
}

function shQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
}

function writeRepositoryHygieneFixture(label, options) {
  const root = path.join(temp, `hygiene-${label}`);
  const scriptsDir = path.join(root, "scripts");
  const handoff = path.join(temp, `hygiene-${label}-handoff`);
  const mirror = path.join(temp, `hygiene-${label}-PRODUCTION.md`);
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(handoff, { recursive: true });

  const attributes = [
    ".gitattributes text eol=lf",
    "scripts/*.sh text eol=lf",
    "PRODUCTION.md text eol=lf"
  ].join("\n");
  if (!options.omitAttributes) {
    writeFileSync(path.join(root, ".gitattributes"), `${attributes}\n`);
  }

  writeFileSync(path.join(root, "PRODUCTION.md"), "guide\n");
  writeFileSync(mirror, options.mirrorMismatch ? "mirror\n" : "guide\n");
  writeFileSync(
    path.join(scriptsDir, "production-operational-evidence-collector.sh"),
    options.collectorCrlf ? "#!/usr/bin/env bash\r\nset -eu\r\n" : "#!/usr/bin/env bash\nset -eu\n"
  );
  writeFileSync(
    path.join(handoff, "collect-production-operational-evidence.sh"),
    options.handoffCollectorCrlf ? "#!/usr/bin/env bash\r\nset -eu\r\n" : "#!/usr/bin/env bash\nset -eu\n"
  );
  return { root, mirror, handoff };
}

function refreshHandoff(bundle) {
  const manifestFile = path.join(bundle, "manifest.json");
  const manifest = readJson(manifestFile);
  manifest.collector.sha256 = sha256(readFileSync(path.join(bundle, "collect-production-operational-evidence.sh")));
  manifest.payload_files = payloadFiles.map((file) => fileMetadata(bundle, file));
  writeJson(manifestFile, manifest);
  const lines = checksumFiles.map((file) => `${sha256(readFileSync(path.join(bundle, file)))}  ${file}`);
  writeFileSync(path.join(bundle, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function fileMetadata(bundle, file) {
  const fullPath = path.join(bundle, file);
  return {
    path: file,
    sha256: sha256(readFileSync(fullPath)),
    bytes: statSync(fullPath).size
  };
}

function appendText(bundle, file, text) {
  writeFileSync(path.join(bundle, file), `${readFileSync(path.join(bundle, file), "utf8")}${text}`);
}

function flatten(value, prefix = "") {
  if (Array.isArray(value)) {
    return [[prefix, value]];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => flatten(nested, prefix === "" ? key : `${prefix}.${key}`));
  }
  return [[prefix, value]];
}

function encodeRecordValue(value) {
  return Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return overrides === undefined ? base : overrides;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

function imageId(char) {
  return `sha256:${char.repeat(64)}`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertLfOnly(file, label) {
  assert.equal(readFileSync(file).includes(13), false, `${label} must use LF line endings`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
}
