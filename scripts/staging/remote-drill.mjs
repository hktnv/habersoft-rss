import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPECTED_MIGRATIONS, EXPECTED_SERVICES, RELEASE_IDENTITY } from "../release-identity.mjs";
import { loadEnvFile, validateStagingEnv, formatEnv } from "./env-inputs.mjs";
import { loadReceipt, validateReceipt } from "./receipt.mjs";
import { compareRollbackCompatibility, loadManifest } from "./package-pair.mjs";
import { assertNoVolumeDeletion, assertPathInsideBase, releaseDir, switchCommands } from "./remote-layout.mjs";
import { validatePreflightReceipt } from "./remote-preflight.mjs";
import {
  assertNoInsecureSshArgs,
  buildScpArgs,
  buildScpDownloadArgs,
  buildSshArgs,
  posixSingleQuote,
  runSsh
} from "./ssh-client.mjs";
import { loadAndValidateTargetConfig } from "./target-config.mjs";

const PREVIOUS_VERSION = "0.1.0-ms-016";
const MIN_CAPACITY_HEADROOM_BYTES = 256 * 1024 * 1024;

export function runRemoteDrill(args) {
  const targetFile = requiredFile(args.target, "target");
  const envFile = requiredFile(args["env-file"], "env-file");
  const target = loadAndValidateTargetConfig(targetFile);
  const operatorEnv = loadEnvFile(envFile);
  validateStagingEnv(operatorEnv, target, "deployment-ready");

  const candidatePackage = requiredDirectory(args["candidate-package"] ?? args.package, "candidate-package");
  const previousPackage = requiredDirectory(args["previous-package"], "previous-package");
  const candidateManifest = loadManifest(candidatePackage);
  const previousManifest = loadManifest(previousPackage);
  validateManifests(previousManifest, candidateManifest);
  const compatibility = compareRollbackCompatibility(previousManifest, candidateManifest);

  const preflightReceipt = args["preflight-receipt"] === undefined ? undefined : loadReceipt(args["preflight-receipt"]);
  if (preflightReceipt !== undefined) {
    validatePreflightReceipt(preflightReceipt);
    assertPreflightReady(preflightReceipt, target);
  }

  const runId = `ms017c-${crypto.randomUUID()}`;
  const receiptFile = resolveExternalReceiptPath(args.receipt, targetFile, runId);
  const outputRoot = path.dirname(receiptFile);
  mkdirSync(outputRoot, { recursive: true });
  const backupFile = path.join(outputRoot, `${runId}-staging-backup.dump`);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "main-service-ms017c-"));

  try {
    const candidateArchive = path.join(tempRoot, "candidate-package.tar");
    const previousArchive = path.join(tempRoot, "previous-package.tar");
    createArchive(candidatePackage, candidateArchive);
    createArchive(previousPackage, previousArchive);

    const candidatePackageSha256 = packageSha256(candidatePackage);
    const previousPackageSha256 = packageSha256(previousPackage);
    const candidateArchiveSha256 = sha256File(candidateArchive);
    const previousArchiveSha256 = sha256File(previousArchive);

    assertCapacity(preflightReceipt, [candidateArchive, previousArchive]);

    const candidateEnvFile = path.join(tempRoot, "candidate.env");
    const previousEnvFile = path.join(tempRoot, "previous.env");
    writePrivateFile(candidateEnvFile, formatEnv({ ...operatorEnv, MAIN_SERVICE_IMAGE: candidateManifest.image.id }));
    writePrivateFile(previousEnvFile, formatEnv({ ...operatorEnv, MAIN_SERVICE_IMAGE: previousManifest.image.id }));
    validateStagingEnv(loadEnvFile(candidateEnvFile), target, "deployment-ready");
    validateStagingEnv(loadEnvFile(previousEnvFile), target, "deployment-ready");

    const remoteNames = remoteTransferNames(previousManifest, candidateManifest, runId);
    runRemotePrepare(target);
    uploadFile(target, candidateArchive, incomingPath(target, remoteNames.candidateArchive), "candidate archive");
    uploadFile(target, previousArchive, incomingPath(target, remoteNames.previousArchive), "previous archive");
    uploadFile(target, candidateEnvFile, incomingPath(target, remoteNames.candidateEnv), "candidate env");
    uploadFile(target, previousEnvFile, incomingPath(target, remoteNames.previousEnv), "previous env");

    const startedAt = new Date();
    const remoteCommand = buildRemoteDrillCommand({
      target,
      runId,
      previousManifest,
      candidateManifest,
      previousPackageSha256,
      candidatePackageSha256,
      previousArchiveSha256,
      candidateArchiveSha256,
      remoteNames
    });
    assertNoVolumeDeletion(remoteCommand);
    assertNoInsecureSshArgs(buildSshArgs(target, remoteCommand));
    const remoteFields = runRemoteCommand(target, remoteCommand, "remote drill", {
      timeoutMs: 1_800_000,
      maxBuffer: 8 * 1024 * 1024
    });

    downloadFile(target, remoteFields.backup_artifact, backupFile, "backup");
    const localBackupSha256 = sha256File(backupFile);
    if (localBackupSha256 !== remoteFields.backup_sha256) {
      throw new Error("downloaded backup checksum mismatch");
    }
    writeJson(`${backupFile}.metadata.json`, {
      schema_version: 1,
      format: "pg_dump custom",
      postgres_image: "postgres:17.9-bookworm",
      created_at: new Date().toISOString(),
      sha256: localBackupSha256
    }, 0o644);
    runRestoreVerification(backupFile);

    const finishedAt = new Date();
    const receipt = {
      schema_version: 1,
      receipt_type: "remote-staging-deployment-rollback-drill",
      target_alias: target.target_alias,
      environment: "staging",
      environment_marker_verified: true,
      edge_mode: target.edge_mode,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      deployed_candidate_version: candidateManifest.version,
      deployed_candidate_commit: candidateManifest.source_commit,
      candidate_package_sha256: candidatePackageSha256,
      candidate_image_id: candidateManifest.image.id,
      previous_version: previousManifest.version,
      previous_commit: previousManifest.source_commit,
      previous_package_sha256: previousPackageSha256,
      previous_image_id: previousManifest.image.id,
      master_release: RELEASE_IDENTITY.masterRelease,
      master_hash: RELEASE_IDENTITY.masterSha256,
      master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
      migration_inventory: [...EXPECTED_MIGRATIONS],
      backup_sha256: localBackupSha256,
      restore_verified: true,
      candidate_deploy_verified: remoteFields.candidate_deploy_verified === "true",
      rollback_verified: remoteFields.rollback_verified === "true",
      roll_forward_verified: remoteFields.roll_forward_verified === "true",
      final_active_version: remoteFields.final_active_version,
      worker_scheduler_verified: remoteFields.worker_scheduler_verified === "true",
      public_ports_verified: remoteFields.public_ports_verified === "true",
      package_pair_compatibility: compatibility,
      sentinel_record_count: Number(remoteFields.sentinel_record_count),
      production_touched: false,
      dns_changed: false,
      tls_changed: false,
      cyberpanel_changed: false,
      external_registry_publish: false,
      git_tag_created: false,
      github_release_created: false
    };
    validateReceipt(receipt);
    writeJson(receiptFile, receipt, 0o644);

    return {
      receipt,
      receiptFile,
      backupFile,
      remoteFields,
      previousPackageSha256,
      candidatePackageSha256,
      previousArchiveSha256,
      candidateArchiveSha256
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function buildRemoteDrillCommand({
  target,
  runId,
  previousManifest,
  candidateManifest,
  previousPackageSha256,
  candidatePackageSha256,
  previousArchiveSha256,
  candidateArchiveSha256,
  remoteNames
}) {
  const baseDir = normalizePosixPath(target.remote_base_dir);
  const previousDir = releaseDir(baseDir, previousManifest.version, previousManifest.source_commit);
  const candidateDir = releaseDir(baseDir, candidateManifest.version, candidateManifest.source_commit);
  const previousSwitch = switchCommands(baseDir, previousDir).join("\n");
  const candidateSwitch = switchCommands(baseDir, candidateDir).join("\n");
  const backupPath = joinPosix(baseDir, "backups", `${runId}.dump`);

  for (const remotePath of [
    previousDir,
    candidateDir,
    backupPath,
    incomingPath(target, remoteNames.previousArchive),
    incomingPath(target, remoteNames.candidateArchive),
    incomingPath(target, remoteNames.previousEnv),
    incomingPath(target, remoteNames.candidateEnv)
  ]) {
    assertPathInsideBase(baseDir, remotePath);
    assertSafeRemotePath(remotePath);
  }

  return [
    "set -eu",
    `base_dir=${posixSingleQuote(baseDir)}`,
    `compose_project=${posixSingleQuote(target.compose_project_name)}`,
    `api_port=${posixSingleQuote(String(target.api_host_port))}`,
    `previous_archive=${posixSingleQuote(incomingPath(target, remoteNames.previousArchive))}`,
    `candidate_archive=${posixSingleQuote(incomingPath(target, remoteNames.candidateArchive))}`,
    `previous_archive_sha256=${posixSingleQuote(previousArchiveSha256)}`,
    `candidate_archive_sha256=${posixSingleQuote(candidateArchiveSha256)}`,
    `previous_package_sha256=${posixSingleQuote(previousPackageSha256)}`,
    `candidate_package_sha256=${posixSingleQuote(candidatePackageSha256)}`,
    `previous_dir=${posixSingleQuote(previousDir)}`,
    `candidate_dir=${posixSingleQuote(candidateDir)}`,
    `previous_env_incoming=${posixSingleQuote(incomingPath(target, remoteNames.previousEnv))}`,
    `candidate_env_incoming=${posixSingleQuote(incomingPath(target, remoteNames.candidateEnv))}`,
    `previous_env=${posixSingleQuote(joinPosix(previousDir, "deployment.env"))}`,
    `candidate_env=${posixSingleQuote(joinPosix(candidateDir, "deployment.env"))}`,
    `previous_image_ref=${posixSingleQuote(previousManifest.image.reference)}`,
    `candidate_image_ref=${posixSingleQuote(candidateManifest.image.reference)}`,
    `previous_image_id=${posixSingleQuote(previousManifest.image.id)}`,
    `candidate_image_id=${posixSingleQuote(candidateManifest.image.id)}`,
    `previous_version=${posixSingleQuote(previousManifest.version)}`,
    `candidate_version=${posixSingleQuote(candidateManifest.version)}`,
    `backup_file=${posixSingleQuote(backupPath)}`,
    "emit() { printf '%s=%s\\n' \"$1\" \"$2\"; }",
    "fail() { emit failure_stage \"$1\"; emit failure_reason \"$2\"; exit 42; }",
    "need_tool() { command -v \"$1\" >/dev/null 2>&1 || fail tooling \"missing-$1\"; }",
    "for tool in docker tar sha256sum curl awk sort tr; do need_tool \"$tool\"; done",
    "docker compose version --short >/dev/null 2>&1 || fail tooling compose-v2-unavailable",
    "verify_sha() { actual=$(sha256sum \"$1\" | awk '{print $1}'); [ \"$actual\" = \"$2\" ] || fail \"$3\" checksum-mismatch; }",
    "extract_release() {",
    "  role=$1 archive=$2 archive_sha=$3 release_dir=$4 env_incoming=$5 env_dest=$6 package_sha=$7",
    "  [ -f \"$archive\" ] || fail \"$role\" archive-missing",
    "  [ -f \"$env_incoming\" ] || fail \"$role\" env-missing",
    "  [ ! -e \"$release_dir\" ] || fail \"$role\" release-dir-exists",
    "  mkdir -p \"$release_dir\"",
    "  verify_sha \"$archive\" \"$archive_sha\" \"$role-transfer\"",
    "  tar -xf \"$archive\" --strip-components=1 -C \"$release_dir\"",
    "  (cd \"$release_dir\" && sha256sum -c checksums.sha256 >/dev/null) || fail \"$role\" package-checksum-failed",
    "  verify_sha \"$release_dir/checksums.sha256\" \"$package_sha\" \"$role-package\"",
    "  mv \"$env_incoming\" \"$env_dest\"",
    "  chmod 600 \"$env_dest\"",
    "}",
    "load_image() {",
    "  role=$1 release_dir=$2 image_ref=$3 expected_image=$4",
    "  docker load --input \"$release_dir/main-service-image.tar\" >/dev/null",
    "  actual=$(docker image inspect --format '{{.Id}}' \"$image_ref\" 2>/dev/null) || fail \"$role\" image-inspect-failed",
    "  [ \"$actual\" = \"$expected_image\" ] || fail \"$role\" image-id-mismatch",
    "}",
    "compose_cmd() { env_file=$1; compose_file=$2; shift 2; docker compose -p \"$compose_project\" --env-file \"$env_file\" -f \"$compose_file\" \"$@\"; }",
    "compose_up_initial() {",
    "  env_file=$1 compose_file=$2",
    "  compose_cmd \"$env_file\" \"$compose_file\" config --quiet >/dev/null",
    "  services=$(compose_cmd \"$env_file\" \"$compose_file\" config --services | sort | tr '\\n' ',')",
    "  [ \"$services\" = 'main-service-api,main-service-worker,migrate,postgres,redis,' ] || fail compose service-inventory-mismatch",
    "  compose_cmd \"$env_file\" \"$compose_file\" pull --policy missing postgres redis >/dev/null",
    "  compose_cmd \"$env_file\" \"$compose_file\" up -d --no-build --pull never --wait --wait-timeout 180 >/dev/null",
    "}",
    "compose_switch_app() {",
    "  env_file=$1 compose_file=$2",
    "  compose_cmd \"$env_file\" \"$compose_file\" up --no-build --pull never --force-recreate --no-deps migrate >/dev/null",
    "  compose_cmd \"$env_file\" \"$compose_file\" up -d --no-build --pull never --force-recreate --no-deps --wait --wait-timeout 180 main-service-api main-service-worker >/dev/null",
    "}",
    "verify_ports() {",
    "  for service in postgres redis main-service-worker; do",
    "    ports=$(docker ps --filter \"label=com.docker.compose.project=$compose_project\" --filter \"label=com.docker.compose.service=$service\" --format '{{.Ports}}')",
    "    [ -z \"$ports\" ] || fail ports public-data-or-worker-port",
    "  done",
    "  api_ports=$(docker ps --filter \"label=com.docker.compose.project=$compose_project\" --filter 'label=com.docker.compose.service=main-service-api' --format '{{.Ports}}')",
    "  case \"$api_ports\" in *\"127.0.0.1:$api_port->3000/tcp\"*) ;; *) fail ports api-loopback-missing ;; esac",
    "  case \"$api_ports\" in *'0.0.0.0'*|*'[::]'*|':::'*) fail ports public-api-listener ;; esac",
    "}",
    "wait_api() {",
    "  endpoint=$1",
    "  attempt=0",
    "  while [ \"$attempt\" -lt 60 ]; do",
    "    code=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \"http://127.0.0.1:$api_port$endpoint\" 2>/dev/null || printf error)",
    "    [ \"$code\" = 200 ] && return 0",
    "    attempt=$((attempt + 1))",
    "    sleep 1",
    "  done",
    "  fail api readiness-timeout",
    "}",
    "psql_count() {",
    "  env_file=$1 compose_file=$2 sql=$3",
    "  printf '%s\\n' \"$sql\" | compose_cmd \"$env_file\" \"$compose_file\" exec -T postgres sh -lc 'psql -X -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -At -v ON_ERROR_STOP=1'",
    "}",
    "verify_images() {",
    "  env_file=$1 compose_file=$2 expected_image=$3",
    "  for service in main-service-api main-service-worker; do",
    "    container=$(compose_cmd \"$env_file\" \"$compose_file\" ps -q \"$service\")",
    "    [ -n \"$container\" ] || fail images \"$service-missing\"",
    "    actual=$(docker inspect -f '{{.Image}}' \"$container\")",
    "    [ \"$actual\" = \"$expected_image\" ] || fail images \"$service-image-mismatch\"",
    "  done",
    "}",
    "verify_worker() {",
    "  env_file=$1 compose_file=$2",
    "  output=$(compose_cmd \"$env_file\" \"$compose_file\" exec -T main-service-worker npm run worker:health)",
    "  case \"$output\" in *'\"scheduler_id\":\"cleanup.daily\"'* ) ;; *) fail worker scheduler-missing ;; esac",
    "  case \"$output\" in *'\"global_concurrency\":1'* ) ;; *) fail worker global-concurrency-missing ;; esac",
    "  case \"$output\" in *'\"local_concurrency\":1'* ) ;; *) fail worker local-concurrency-missing ;; esac",
    "}",
    "verify_migrations() {",
    "  env_file=$1 compose_file=$2",
    "  output=$(compose_cmd \"$env_file\" \"$compose_file\" exec -T main-service-api npm run migrate:status)",
    "  case \"$output\" in *'Database schema is up to date'*|*'already in sync'*|*'No pending migrations'* ) ;; *) fail migrations status-not-clean ;; esac",
    "  count=$(psql_count \"$env_file\" \"$compose_file\" \"select count(*) from _prisma_migrations where migration_name in ('20260620000000_initial_empty','20260620001000_canonical_business_schema');\" | tr -d '\\r')",
    "  [ \"$count\" = 2 ] || fail migrations inventory-mismatch",
    "}",
    "agent_tenant_smoke() {",
    "  env_file=$1 compose_file=$2",
    "  output=$(compose_cmd \"$env_file\" \"$compose_file\" exec -T main-service-api node - <<'NODE'",
    "const heartbeat = await fetch('http://127.0.0.1:3000/agent/heartbeat', {",
    "  method: 'POST',",
    "  headers: { 'content-type': 'application/json', 'X-Agent-Key': process.env.AGENT_KEY },",
    "  body: JSON.stringify({",
    "    status: 'ok',",
    "    sent_at: new Date().toISOString(),",
    "    feeds_processed: 17,",
    "    errors_count: 0,",
    "    stale_check_results_dropped: 0,",
    "    stale_entries_dropped: 0",
    "  })",
    "});",
    "if (!heartbeat.ok) throw new Error(`agent heartbeat ${heartbeat.status}`);",
    "const body = await heartbeat.json();",
    "if (body.ok !== true) throw new Error('agent heartbeat body mismatch');",
    "const tenant = await fetch('http://127.0.0.1:3000/api/feeds');",
    "if (tenant.status !== 401) throw new Error(`tenant unauth status ${tenant.status}`);",
    "console.log('agent_tenant_smoke=ok');",
    "NODE",
    ")",
    "  case \"$output\" in *'agent_tenant_smoke=ok'* ) ;; *) fail smoke agent-tenant-smoke-failed ;; esac",
    "}",
    "verify_sentinel() {",
    "  env_file=$1 compose_file=$2",
    "  count=$(psql_count \"$env_file\" \"$compose_file\" \"select count(*) from agent_runtime_status where agent_id='default' and status='ok';\" | tr -d '\\r')",
    "  [ \"$count\" = 1 ] || fail sentinel count-mismatch",
    "}",
    "verify_active_version() {",
    "  env_file=$1 compose_file=$2 expected_version=$3",
    "  version=$(compose_cmd \"$env_file\" \"$compose_file\" exec -T main-service-api node -p \"require('./package.json').version\" | tr -d '\\r')",
    "  [ \"$version\" = \"$expected_version\" ] || fail version active-version-mismatch",
    "}",
    "verify_phase() {",
    "  env_file=$1 compose_file=$2 expected_image=$3 expected_version=$4",
    "  verify_images \"$env_file\" \"$compose_file\" \"$expected_image\"",
    "  wait_api /health/live",
    "  wait_api /health/ready",
    "  verify_worker \"$env_file\" \"$compose_file\"",
    "  verify_migrations \"$env_file\" \"$compose_file\"",
    "  agent_tenant_smoke \"$env_file\" \"$compose_file\"",
    "  verify_sentinel \"$env_file\" \"$compose_file\"",
    "  verify_ports",
    "  verify_active_version \"$env_file\" \"$compose_file\" \"$expected_version\"",
    "}",
    "extract_release previous \"$previous_archive\" \"$previous_archive_sha256\" \"$previous_dir\" \"$previous_env_incoming\" \"$previous_env\" \"$previous_package_sha256\"",
    "extract_release candidate \"$candidate_archive\" \"$candidate_archive_sha256\" \"$candidate_dir\" \"$candidate_env_incoming\" \"$candidate_env\" \"$candidate_package_sha256\"",
    "previous_compose=\"$previous_dir/deploy/production/compose.yaml\"",
    "candidate_compose=\"$candidate_dir/deploy/production/compose.yaml\"",
    "load_image previous \"$previous_dir\" \"$previous_image_ref\" \"$previous_image_id\"",
    "load_image candidate \"$candidate_dir\" \"$candidate_image_ref\" \"$candidate_image_id\"",
    "compose_up_initial \"$candidate_env\" \"$candidate_compose\"",
    "verify_phase \"$candidate_env\" \"$candidate_compose\" \"$candidate_image_id\" \"$candidate_version\"",
    candidateSwitch,
    "compose_cmd \"$candidate_env\" \"$candidate_compose\" exec -T postgres sh -lc 'pg_dump -Fc -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\"' > \"$backup_file\"",
    "backup_sha256=$(sha256sum \"$backup_file\" | awk '{print $1}')",
    "compose_switch_app \"$previous_env\" \"$previous_compose\"",
    "verify_phase \"$previous_env\" \"$previous_compose\" \"$previous_image_id\" \"$previous_version\"",
    previousSwitch,
    "compose_switch_app \"$candidate_env\" \"$candidate_compose\"",
    "verify_phase \"$candidate_env\" \"$candidate_compose\" \"$candidate_image_id\" \"$candidate_version\"",
    candidateSwitch,
    "sentinel_count=$(psql_count \"$candidate_env\" \"$candidate_compose\" \"select count(*) from agent_runtime_status where agent_id='default' and status='ok';\" | tr -d '\\r')",
    "emit status remote-staging-drill-passed",
    "emit previous_transfer_verified true",
    "emit candidate_transfer_verified true",
    "emit previous_image_id \"$previous_image_id\"",
    "emit candidate_image_id \"$candidate_image_id\"",
    "emit candidate_deploy_verified true",
    "emit rollback_verified true",
    "emit roll_forward_verified true",
    "emit final_active_version \"$candidate_version\"",
    "emit worker_scheduler_verified true",
    "emit public_ports_verified true",
    "emit sentinel_record_count \"$sentinel_count\"",
    "emit backup_sha256 \"$backup_sha256\"",
    "emit backup_artifact \"$backup_file\"",
    "emit production_touched false",
    "emit external_registry_publish false"
  ].join("\n");
}

export function buildRemotePrepareCommand(target) {
  const baseDir = normalizePosixPath(target.remote_base_dir);
  assertSafeRemotePath(baseDir);
  return [
    "set -eu",
    `marker_path=${posixSingleQuote(target.remote_environment_marker_path)}`,
    `marker_expected=${posixSingleQuote(target.remote_environment_marker_value)}`,
    `base_dir=${posixSingleQuote(baseDir)}`,
    "emit() { printf '%s=%s\\n' \"$1\" \"$2\"; }",
    "fail() { emit failure_stage \"$1\"; emit failure_reason \"$2\"; exit 42; }",
    "[ -f \"$marker_path\" ] || fail marker missing",
    "[ ! -L \"$marker_path\" ] || fail marker symlink",
    "marker_value=$(cat \"$marker_path\") || fail marker unreadable",
    "[ \"$marker_value\" = \"$marker_expected\" ] || fail marker mismatch",
    "mkdir -p \"$base_dir/incoming\" \"$base_dir/releases\" \"$base_dir/backups\"",
    "chmod 700 \"$base_dir\" \"$base_dir/incoming\" \"$base_dir/backups\"",
    "emit status remote-prepare-passed",
    "emit remote_mutation_performed true"
  ].join("\n");
}

function runRemotePrepare(target) {
  const command = buildRemotePrepareCommand(target);
  assertNoVolumeDeletion(command);
  assertNoInsecureSshArgs(buildSshArgs(target, command));
  const fields = runRemoteCommand(target, command, "remote prepare", { timeoutMs: 120_000 });
  if (fields.status !== "remote-prepare-passed") {
    throw new Error("remote prepare did not pass");
  }
}

function runRemoteCommand(target, command, label, options) {
  const result = runSsh(target, command, options);
  const fields = parseRemoteFields(result.stdout);
  if (result.status !== 0) {
    const stage = safeIdentifier(fields.failure_stage ?? label.replace(/\s+/gu, "-"));
    const reason = safeIdentifier(fields.failure_reason ?? "command-failed");
    throw new Error(`${label} failed at ${stage}: ${reason}`);
  }
  return fields;
}

function uploadFile(target, source, destination, label) {
  assertPathInsideBase(target.remote_base_dir, destination);
  assertSafeRemotePath(destination);
  const args = buildScpArgs(target, path.resolve(source), destination);
  assertNoInsecureSshArgs(args);
  const result = spawnSync("scp", args, {
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`scp upload failed for ${label}`);
  }
}

function downloadFile(target, source, destination, label) {
  assertPathInsideBase(target.remote_base_dir, source);
  assertSafeRemotePath(source);
  const args = buildScpDownloadArgs(target, source, path.resolve(destination));
  assertNoInsecureSshArgs(args);
  const result = spawnSync("scp", args, {
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`scp download failed for ${label}`);
  }
}

function createArchive(packageDir, archiveFile) {
  const parent = path.dirname(packageDir);
  const basename = path.basename(packageDir);
  const result = spawnSync("tar", ["-C", parent, "-cf", archiveFile, basename], {
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error("package archive creation failed");
  }
}

function runRestoreVerification(backupFile) {
  const result = spawnSync(process.execPath, ["scripts/production-restore-verify.mjs", "--backup", backupFile], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error("off-host restore verification failed");
  }
}

function validateManifests(previousManifest, candidateManifest) {
  assert(previousManifest.version === PREVIOUS_VERSION, "previous package version mismatch");
  assert(candidateManifest.version === RELEASE_IDENTITY.version, "candidate package version mismatch");
  assert(previousManifest.source_commit !== candidateManifest.source_commit, "previous and candidate commits must differ");
  assert(previousManifest.image?.included === true, "previous package must include image");
  assert(candidateManifest.image?.included === true, "candidate package must include image");
  assert(/^sha256:[a-f0-9]{64}$/u.test(previousManifest.image.id), "previous image id is invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(candidateManifest.image.id), "candidate image id is invalid");
  assert(previousManifest.image.id !== candidateManifest.image.id, "previous and candidate image ids must differ");
  assert(JSON.stringify(candidateManifest.migrations) === JSON.stringify(EXPECTED_MIGRATIONS), "candidate migration inventory mismatch");
  assert(JSON.stringify(candidateManifest.services) === JSON.stringify(EXPECTED_SERVICES), "candidate service inventory mismatch");
}

function assertPreflightReady(receipt, target) {
  assert(receipt.target_alias === target.target_alias, "preflight target alias mismatch");
  assert(receipt.project_state === "absent", "preflight project state must be absent before first deployment");
  assert(receipt.api_port_state === "available", "preflight API port must be available before first deployment");
  assert(receipt.base_dir_state === "existing-empty-approved" || receipt.base_dir_state === "absent-parent-ready", "preflight base dir must be empty or absent-parent-ready before package transfer");
  assert(receipt.inventory_unchanged === true, "preflight inventory must be unchanged");
  assert(receipt.remote_mutation_performed === false, "preflight must be read-only");
}

function assertCapacity(preflightReceipt, files) {
  if (preflightReceipt === undefined) {
    return;
  }
  const transferBytes = files.reduce((total, file) => total + statSync(file).size, 0);
  const requiredBytes = Math.ceil(transferBytes * 3 + MIN_CAPACITY_HEADROOM_BYTES);
  assert(preflightReceipt.disk_free_bytes >= requiredBytes, "remote disk capacity gate failed");
}

function remoteTransferNames(previousManifest, candidateManifest, runId) {
  return {
    previousArchive: `${runId}-previous-${previousManifest.version}-${previousManifest.source_commit.slice(0, 12)}.tar`,
    candidateArchive: `${runId}-candidate-${candidateManifest.version}-${candidateManifest.source_commit.slice(0, 12)}.tar`,
    previousEnv: `${runId}-previous.env`,
    candidateEnv: `${runId}-candidate.env`
  };
}

function incomingPath(target, name) {
  return joinPosix(target.remote_base_dir, "incoming", name);
}

function parseRemoteFields(stdout) {
  const fields = {};
  for (const rawLine of String(stdout ?? "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("remote command returned unexpected output");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[a-z0-9_]+$/u.test(key)) {
      throw new Error("remote command returned unsafe key");
    }
    if (Object.hasOwn(fields, key)) {
      throw new Error(`remote command returned duplicate key ${key}`);
    }
    fields[key] = value;
  }
  return fields;
}

function resolveExternalReceiptPath(value, targetFile, runId) {
  const file = value === undefined
    ? path.join(path.dirname(path.resolve(targetFile)), `${runId}-deployment-receipt.json`)
    : path.resolve(value);
  const relative = path.relative(process.cwd(), file);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("receipt path must be outside the repository");
  }
  return file;
}

function requiredFile(file, name) {
  const resolved = path.resolve(requiredString(file, name));
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`${name} must exist`);
  }
  return resolved;
}

function requiredDirectory(directory, name) {
  const resolved = path.resolve(requiredString(directory, name));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`${name} must be an existing directory`);
  }
  return resolved;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function writePrivateFile(file, text) {
  writeFileSync(file, text, { mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(file, 0o600);
  }
}

function writeJson(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  if (process.platform !== "win32") {
    chmodSync(file, mode);
  }
}

function packageSha256(packageDir) {
  return sha256File(path.join(packageDir, "checksums.sha256"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
}

function normalizePosixPath(value) {
  return String(value).replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "") || "/";
}

function joinPosix(...parts) {
  return normalizePosixPath(parts.join("/"));
}

function assertSafeRemotePath(value) {
  if (!/^[-A-Za-z0-9_./]+$/u.test(String(value))) {
    throw new Error("remote path contains unsupported characters");
  }
}

function safeIdentifier(value) {
  const normalized = String(value ?? "unknown").trim();
  return /^[A-Za-z0-9_.:-]+$/u.test(normalized) ? normalized : "unsafe";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
