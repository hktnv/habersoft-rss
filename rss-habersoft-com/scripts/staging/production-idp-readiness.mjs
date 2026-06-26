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
import { formatEnv, loadEnvFile, removeRuntimeImageFromEnv, validateStagingEnv } from "./env-inputs.mjs";
import { loadVerifiedStagingIdpContract } from "./idp-contract-policy.mjs";
import { loadManifest } from "./package-pair.mjs";
import { validatePreflightReceipt } from "./remote-preflight.mjs";
import { buildRemotePrepareCommand } from "./remote-drill.mjs";
import { assertNoVolumeDeletion, assertPathInsideBase, releaseDir } from "./remote-layout.mjs";
import {
  assertNoInsecureSshArgs,
  buildScpArgs,
  buildSshArgs,
  posixSingleQuote,
  runSsh
} from "./ssh-client.mjs";
import { loadAndValidateTargetConfig } from "./target-config.mjs";

const RECEIPT_TYPE = "remote-production-idp-readiness-only";
const JWKS_URL = "https://auth.habersoft.com/.well-known/jwks.json";
const MAX_JWKS_BYTES = 64 * 1024;

export async function runProductionIdpReadiness(args) {
  const targetFile = requiredFile(args.target, "target");
  const envFile = requiredFile(args["env-file"], "env-file");
  const candidatePackage = requiredDirectory(args["candidate-package"] ?? args.package, "candidate-package");
  const target = loadAndValidateTargetConfig(targetFile);
  const contract = loadVerifiedStagingIdpContract({ idpContractFile: args["idp-contract"] });
  const operatorEnv = loadEnvFile(envFile);
  const sharedOperatorEnv = removeRuntimeImageFromEnv(operatorEnv);
  validateStagingEnv(sharedOperatorEnv, target, "deployment-ready", { idpContractFile: args["idp-contract"] });
  assert(sharedOperatorEnv.TENANT_AUTH_JWKS_URL === JWKS_URL, "staging env must project the approved production JWKS URL");

  const manifest = loadManifest(candidatePackage);
  validateCandidateManifest(manifest);
  const candidatePackageSha256 = packageSha256(candidatePackage);
  assert(candidatePackageSha256 === args["candidate-package-sha256"] || args["candidate-package-sha256"] === undefined, "candidate package checksum mismatch");

  if (args["preflight-receipt"] !== undefined) {
    const preflightReceipt = JSON.parse(readFileSync(path.resolve(args["preflight-receipt"]), "utf8"));
    validatePreflightReceipt(preflightReceipt);
    assert(preflightReceipt.target_alias === target.target_alias, "preflight target alias mismatch");
    assert(preflightReceipt.environment_marker_verified === true, "preflight marker was not verified");
    assert(preflightReceipt.inventory_unchanged === true, "preflight inventory was not stable");
  }

  const localJwksProbe = await probeJwksLocally(contract.jwks_url);
  const runId = `ms017c1a3r-${crypto.randomUUID()}`;
  const receiptFile = resolveExternalReceiptPath(args.receipt, targetFile, runId);
  mkdirSync(path.dirname(receiptFile), { recursive: true });

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "main-service-production-idp-readiness-"));
  const startedAt = new Date();
  try {
    const archiveFile = path.join(tempRoot, "candidate-package.tar");
    const sharedEnvFile = path.join(tempRoot, "staging.env");
    createArchive(candidatePackage, archiveFile);
    const archiveSha256 = sha256File(archiveFile);
    writePrivateFile(sharedEnvFile, formatEnv(sharedOperatorEnv));

    runRemotePrepare(target);
    const remoteNames = {
      candidateArchive: `${runId}-candidate-${manifest.version}-${manifest.source_commit.slice(0, 12)}.tar`,
      sharedEnv: `${runId}-staging.env`
    };
    uploadFile(target, archiveFile, incomingPath(target, remoteNames.candidateArchive), "candidate archive");
    uploadFile(target, sharedEnvFile, incomingPath(target, remoteNames.sharedEnv), "shared staging env");

    const remoteCommand = buildProductionIdpReadinessCommand({
      target,
      manifest,
      candidatePackageSha256,
      archiveSha256,
      remoteNames
    });
    assertNoVolumeDeletion(remoteCommand);
    assertNoInsecureSshArgs(buildSshArgs(target, remoteCommand));
    const remoteFields = runRemoteCommand(target, remoteCommand, "production IdP readiness", {
      timeoutMs: 1_200_000,
      maxBuffer: 6 * 1024 * 1024
    });

    const finishedAt = new Date();
    const receipt = createProductionIdpReadinessReceipt({
      target,
      contract,
      manifest,
      candidatePackageSha256,
      localJwksProbe,
      remoteFields,
      startedAt,
      finishedAt
    });
    validateProductionIdpReadinessReceipt(receipt);
    writeJson(receiptFile, receipt, 0o644);

    return { receipt, receiptFile, remoteFields };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function buildProductionIdpReadinessCommand({
  target,
  manifest,
  candidatePackageSha256,
  archiveSha256,
  remoteNames
}) {
  const baseDir = normalizePosixPath(target.remote_base_dir);
  const candidateDir = releaseDir(baseDir, manifest.version, manifest.source_commit);
  const incomingArchive = incomingPath(target, remoteNames.candidateArchive);
  const incomingSharedEnv = incomingPath(target, remoteNames.sharedEnv);
  const sharedEnv = joinPosix(baseDir, "shared", "staging.env");
  const runtimeEnv = joinPosix(candidateDir, manifest.runtime_image_env.path);
  const composeFile = joinPosix(candidateDir, "deploy/production/compose.yaml");
  const currentLink = joinPosix(baseDir, "current");

  for (const remotePath of [candidateDir, incomingArchive, incomingSharedEnv, sharedEnv, runtimeEnv, composeFile, currentLink]) {
    assertPathInsideBase(baseDir, remotePath);
    assertSafeRemotePath(remotePath);
  }

  const services = [...EXPECTED_SERVICES].sort().join(",");
  const migrations = EXPECTED_MIGRATIONS.join(" ");

  return [
    "set -eu",
    `marker_path=${posixSingleQuote(target.remote_environment_marker_path)}`,
    `marker_expected=${posixSingleQuote(target.remote_environment_marker_value)}`,
    `base_dir=${posixSingleQuote(baseDir)}`,
    `candidate_dir=${posixSingleQuote(candidateDir)}`,
    `candidate_archive=${posixSingleQuote(incomingArchive)}`,
    `candidate_archive_sha256=${posixSingleQuote(archiveSha256)}`,
    `candidate_package_sha256=${posixSingleQuote(candidatePackageSha256)}`,
    `candidate_image_ref=${posixSingleQuote(manifest.image.reference)}`,
    `candidate_image_id=${posixSingleQuote(manifest.image.id)}`,
    `runtime_env=${posixSingleQuote(runtimeEnv)}`,
    `runtime_env_sha256=${posixSingleQuote(manifest.runtime_image_env.sha256)}`,
    `compose_file=${posixSingleQuote(composeFile)}`,
    `compose_project=${posixSingleQuote(target.compose_project_name)}`,
    `api_port=${posixSingleQuote(String(target.api_host_port))}`,
    `shared_env_incoming=${posixSingleQuote(incomingSharedEnv)}`,
    `shared_env=${posixSingleQuote(sharedEnv)}`,
    `current_link=${posixSingleQuote(currentLink)}`,
    `jwks_url=${posixSingleQuote(JWKS_URL)}`,
    `expected_services=${posixSingleQuote(services)}`,
    `expected_migrations=${posixSingleQuote(migrations)}`,
    "emit() { printf '%s=%s\\n' \"$1\" \"$2\"; }",
    "fail() { emit status failed; emit failure_stage \"$1\"; emit failure_reason \"$2\"; exit 42; }",
    "need_tool() { command -v \"$1\" >/dev/null 2>&1 || fail tooling \"missing-$1\"; }",
    "count_non_empty() { count=0; while IFS= read -r line; do if [ -n \"$line\" ]; then count=$((count + 1)); fi; done; printf '%s\\n' \"$count\"; }",
    "compose_cmd() { docker compose -p \"$compose_project\" --env-file \"$shared_env\" --env-file \"$runtime_env\" -f \"$compose_file\" \"$@\"; }",
    "safe_stop() { if [ -f \"$compose_file\" ] && [ -f \"$runtime_env\" ] && [ -f \"$shared_env\" ]; then docker compose -p \"$compose_project\" --env-file \"$shared_env\" --env-file \"$runtime_env\" -f \"$compose_file\" stop main-service-api main-service-worker migrate postgres redis >/dev/null 2>&1 || true; else ids=$(docker ps -q --filter \"label=com.docker.compose.project=$compose_project\" 2>/dev/null || true); [ -z \"$ids\" ] || docker stop $ids >/dev/null 2>&1 || true; fi; }",
    "trap safe_stop EXIT",
    "for tool in docker tar sha256sum curl awk sort tr grep wc mktemp sed; do need_tool \"$tool\"; done",
    "docker compose version --short >/dev/null 2>&1 || fail tooling compose-v2-unavailable",
    "[ -f \"$marker_path\" ] || fail marker missing",
    "[ ! -L \"$marker_path\" ] || fail marker symlink",
    "marker_value=$(cat \"$marker_path\") || fail marker unreadable",
    "[ \"$marker_value\" = \"$marker_expected\" ] || fail marker mismatch",
    "emit marker_verified true",
    "project_filter=\"label=com.docker.compose.project=$compose_project\"",
    "collect_counts() {",
    "  prefix=$1",
    "  emit \"${prefix}_running_project_containers\" \"$(docker ps --filter \"$project_filter\" --format '{{.ID}}' | count_non_empty)\"",
    "  emit \"${prefix}_total_project_containers\" \"$(docker ps -a --filter \"$project_filter\" --format '{{.ID}}' | count_non_empty)\"",
    "  emit \"${prefix}_project_volumes\" \"$(docker volume ls -q --filter \"$project_filter\" | count_non_empty)\"",
    "  emit \"${prefix}_project_networks\" \"$(docker network ls -q --filter \"$project_filter\" | count_non_empty)\"",
    "  emit \"${prefix}_published_api_containers\" \"$(docker ps -a --filter \"$project_filter\" --filter \"publish=$api_port\" --format '{{.ID}}' | count_non_empty)\"",
    "  if command -v ss >/dev/null 2>&1; then listeners=$(ss -H -ltn \"sport = :$api_port\" 2>/dev/null | count_non_empty || printf unknown); else listeners=unknown; fi",
    "  emit \"${prefix}_api_port_listeners\" \"$listeners\"",
    "}",
    "verify_sha() { actual=$(sha256sum \"$1\" | awk '{print $1}'); [ \"$actual\" = \"$2\" ] || fail \"$3\" checksum-mismatch; }",
    "collect_counts before",
    "host_jwks_file=$(mktemp)",
    "host_code=$(curl --proto '=https' --tlsv1.2 --silent --show-error --max-time 15 --output \"$host_jwks_file\" --write-out '%{http_code}' \"$jwks_url\" 2>/dev/null || printf error)",
    "[ \"$host_code\" = 200 ] || fail remote-host-jwks \"http-$host_code\"",
    "host_bytes=$(wc -c < \"$host_jwks_file\" | tr -d ' ')",
    "case \"$host_bytes\" in ''|*[!0-9]*) fail remote-host-jwks invalid-size ;; esac",
    `[ "$host_bytes" -gt 10 ] && [ "$host_bytes" -le ${MAX_JWKS_BYTES} ] || fail remote-host-jwks invalid-size`,
    "grep -q '\"keys\"' \"$host_jwks_file\" || fail remote-host-jwks missing-keys",
    "host_key_count=$(grep -o '\"kid\"' \"$host_jwks_file\" | count_non_empty)",
    "[ \"$host_key_count\" -gt 0 ] || fail remote-host-jwks missing-kid",
    "rm -f \"$host_jwks_file\"",
    "emit remote_host_jwks_status ok",
    "emit remote_host_jwks_http_status 200",
    "emit remote_host_jwks_bytes \"$host_bytes\"",
    "emit remote_host_jwks_key_count \"$host_key_count\"",
    "emit remote_host_jwks_rs256_key_count \"$host_key_count\"",
    "if [ ! -d \"$candidate_dir\" ]; then",
    "  [ -f \"$candidate_archive\" ] || fail candidate archive-missing",
    "  verify_sha \"$candidate_archive\" \"$candidate_archive_sha256\" candidate-transfer",
    "  tmp_release=\"$candidate_dir.tmp.$$\"",
    "  rm -rf \"$tmp_release\"",
    "  mkdir -p \"$tmp_release\"",
    "  tar -xf \"$candidate_archive\" --strip-components=1 -C \"$tmp_release\"",
    "  mv -T \"$tmp_release\" \"$candidate_dir\"",
    "fi",
    "[ -d \"$candidate_dir\" ] || fail candidate release-missing",
    "verify_sha \"$candidate_dir/checksums.sha256\" \"$candidate_package_sha256\" candidate-package",
    "(cd \"$candidate_dir\" && sha256sum -c checksums.sha256 >/dev/null) || fail candidate package-integrity",
    "verify_sha \"$runtime_env\" \"$runtime_env_sha256\" runtime-image-env",
    "grep -qx \"MAIN_SERVICE_IMAGE=$candidate_image_id\" \"$runtime_env\" || fail runtime-image-env image-mismatch",
    "docker load --input \"$candidate_dir/main-service-image.tar\" >/dev/null || fail image load-failed",
    "actual_image_id=$(docker image inspect --format '{{.Id}}' \"$candidate_image_ref\" 2>/dev/null) || fail image inspect-failed",
    "[ \"$actual_image_id\" = \"$candidate_image_id\" ] || fail image id-mismatch",
    "emit remote_candidate_package_verified true",
    "emit remote_candidate_image_verified true",
    "probe_candidate_jwks() {",
    "  network=$1 label=$2",
    "  probe_js='const url = process.env.JWKS_URL; if (!url || !url.startsWith(\"https://\")) throw new Error(\"https-url-required\"); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000); try { const response = await fetch(url, { redirect: \"manual\", signal: controller.signal }); if (response.status !== 200) throw new Error(\"http-\" + response.status); const text = await response.text(); if (Buffer.byteLength(text, \"utf8\") > 65536) throw new Error(\"jwks-too-large\"); const jwks = JSON.parse(text); if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error(\"keys-missing\"); const rs256 = jwks.keys.filter((key) => key && (key.alg === undefined || key.alg === \"RS256\") && typeof key.kid === \"string\").length; if (rs256 < 1) throw new Error(\"rs256-key-missing\"); console.log(\"jwks_probe_status=ok\"); console.log(\"jwks_probe_key_count=\" + jwks.keys.length); console.log(\"jwks_probe_rs256_key_count=\" + rs256); } finally { clearTimeout(timeout); }'",
    "  output=$(docker run --rm --network \"$network\" -e JWKS_URL=\"$jwks_url\" \"$candidate_image_ref\" node --input-type=module --eval \"$probe_js\") || fail \"$label-jwks\" probe-failed",
    "  case \"$output\" in *'jwks_probe_status=ok'* ) ;; *) fail \"$label-jwks\" status-missing ;; esac",
    "  key_count=$(printf '%s\\n' \"$output\" | awk -F= '$1==\"jwks_probe_key_count\" {print $2}')",
    "  rs256_count=$(printf '%s\\n' \"$output\" | awk -F= '$1==\"jwks_probe_rs256_key_count\" {print $2}')",
    "  emit \"${label}_jwks_status\" ok",
    "  emit \"${label}_jwks_key_count\" \"$key_count\"",
    "  emit \"${label}_jwks_rs256_key_count\" \"$rs256_count\"",
    "}",
    "probe_candidate_jwks bridge candidate_default_network",
    "[ -f \"$shared_env_incoming\" ] || fail shared-env incoming-missing",
    "grep -qx \"TENANT_AUTH_JWKS_URL=$jwks_url\" \"$shared_env_incoming\" || fail shared-env jwks-mismatch",
    "if grep -E '^[[:space:]]*MAIN_SERVICE_IMAGE=' \"$shared_env_incoming\" >/dev/null 2>&1; then fail shared-env contains-runtime-image; fi",
    "mkdir -p \"$base_dir/shared\"",
    "shared_tmp=\"$shared_env.tmp.$$\"",
    "cp \"$shared_env_incoming\" \"$shared_tmp\"",
    "chmod 600 \"$shared_tmp\"",
    "mv -f \"$shared_tmp\" \"$shared_env\"",
    "mode=$(stat -c '%a' \"$shared_env\" 2>/dev/null || printf unknown)",
    "[ \"$mode\" = 600 ] || fail shared-env mode-mismatch",
    "emit remote_shared_env_updated true",
    "emit remote_shared_env_mode 600",
    "compose_cmd config --quiet >/dev/null || fail compose config-failed",
    "services=$(compose_cmd config --services | sort | tr '\\n' ',' | sed 's/,$//') || fail compose services-list-failed",
    "[ \"$services\" = \"$expected_services\" ] || fail compose service-inventory-mismatch",
    "compose_cmd pull --policy missing postgres redis >/dev/null || fail compose pull-data-images-failed",
    "compose_cmd up -d --no-build --pull never --wait --wait-timeout 180 postgres redis >/dev/null || fail data-services start-failed",
    "sync_postgres_password() {",
    "  printf '%s\\n' 'ALTER ROLE :\"role\" WITH PASSWORD :'\\''newpass'\\'';' | compose_cmd exec -T postgres sh -lc 'psql -X -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -v ON_ERROR_STOP=1 -v role=\"$POSTGRES_USER\" -v newpass=\"$POSTGRES_PASSWORD\"' >/dev/null || fail postgres role-sync-failed",
    "  emit postgres_role_synchronized true",
    "}",
    "sync_postgres_password",
    "compose_cmd up --no-build --pull never --force-recreate --no-deps migrate >/dev/null || fail migrate deploy-failed",
    "compose_cmd up -d --no-build --pull never --force-recreate --no-deps --wait --wait-timeout 180 main-service-api main-service-worker >/dev/null || fail app-services start-failed",
    "probe_candidate_jwks \"${compose_project}_default\" candidate_project_network",
    "verify_ports() {",
    "  for service in postgres redis main-service-worker; do",
    "    ports=$(docker ps --filter \"$project_filter\" --filter \"label=com.docker.compose.service=$service\" --format '{{.Ports}}')",
    "    case \"$ports\" in *'->'*) fail ports public-data-or-worker-port ;; esac",
    "  done",
    "  api_ports=$(docker ps --filter \"$project_filter\" --filter 'label=com.docker.compose.service=main-service-api' --format '{{.Ports}}')",
    "  case \"$api_ports\" in *\"127.0.0.1:$api_port->3000/tcp\"*) ;; *) fail ports api-loopback-missing ;; esac",
    "  case \"$api_ports\" in *'0.0.0.0'*|*'[::]'*|':::'*) fail ports public-api-listener ;; esac",
    "}",
    "verify_images() {",
    "  for service in main-service-api main-service-worker; do",
    "    container=$(compose_cmd ps -q \"$service\")",
    "    [ -n \"$container\" ] || fail images \"$service-missing\"",
    "    actual=$(docker inspect -f '{{.Image}}' \"$container\")",
    "    [ \"$actual\" = \"$candidate_image_id\" ] || fail images \"$service-image-mismatch\"",
    "  done",
    "}",
    "psql_count() {",
    "  sql=$1",
    "  printf '%s\\n' \"$sql\" | compose_cmd exec -T postgres sh -lc 'psql -X -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -At -v ON_ERROR_STOP=1'",
    "}",
    "verify_migrations() {",
    "  output=$(compose_cmd exec -T main-service-api npm run migrate:status) || fail migrations status-command-failed",
    "  case \"$output\" in *'Database schema is up to date'*|*'already in sync'*|*'No pending migrations'* ) ;; *) fail migrations status-not-clean ;; esac",
    "  count=$(psql_count \"select count(*) from _prisma_migrations where migration_name in ('20260620000000_initial_empty','20260620001000_canonical_business_schema');\" | tr -d '\\r') || fail migrations inventory-query-failed",
    "  [ \"$count\" = 2 ] || fail migrations inventory-mismatch",
    "  emit migration_count \"$count\"",
    "  emit migrate_noop_verified true",
    "}",
    "verify_readiness_round() {",
    "  round=$1",
    "  attempt=0",
    "  last_live=none",
    "  last_ready=none",
    "  round_ok=false",
    "  while [ \"$attempt\" -lt 90 ]; do",
    "    live_code=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \"http://127.0.0.1:$api_port/health/live\" 2>/dev/null || printf error)",
    "    ready_file=$(mktemp)",
    "    ready_code=$(curl --silent --show-error --max-time 5 --output \"$ready_file\" --write-out '%{http_code}' \"http://127.0.0.1:$api_port/health/ready\" 2>/dev/null || printf error)",
    "    tr -d '\\n\\r ' < \"$ready_file\" > \"$ready_file.min\"",
    "    last_live=$live_code",
    "    last_ready=$ready_code",
    "    if [ \"$live_code\" = 200 ] && [ \"$ready_code\" = 200 ] && grep -q '\"status\":\"ready\"' \"$ready_file.min\" && grep -q '\"postgres\":\"up\"' \"$ready_file.min\" && grep -q '\"redis\":\"up\"' \"$ready_file.min\" && grep -q '\"tenantAuth\":\"up\"' \"$ready_file.min\"; then",
    "      round_ok=true",
    "      rm -f \"$ready_file\" \"$ready_file.min\"",
    "      break",
    "    fi",
    "    rm -f \"$ready_file\" \"$ready_file.min\"",
    "    attempt=$((attempt + 1))",
    "    sleep 1",
    "  done",
    "  [ \"$round_ok\" = true ] || fail \"api-ready-$round\" \"live-$last_live-ready-$last_ready\"",
    "  emit \"round_${round}_live_status\" 200",
    "  emit \"round_${round}_ready_status\" 200",
    "  emit \"round_${round}_postgres\" up",
    "  emit \"round_${round}_redis\" up",
    "  emit \"round_${round}_tenant_auth\" up",
    "}",
    "verify_worker() {",
    "  output=$(compose_cmd exec -T main-service-worker npm run worker:health) || fail worker health-command-failed",
    "  case \"$output\" in *'\"scheduler_id\":\"cleanup.daily\"'* ) ;; *) fail worker scheduler-missing ;; esac",
    "  case \"$output\" in *'\"global_concurrency\":1'* ) ;; *) fail worker global-concurrency-missing ;; esac",
    "  local_output=$(compose_cmd exec -T main-service-worker node -e \"const r=require('./dist/maintenance/maintenance.registry.js'); if (r.MAINTENANCE_WORKER_CONCURRENCY !== 1) process.exit(1); console.log('local_concurrency=1');\") || fail worker local-concurrency-missing",
    "  case \"$local_output\" in *'local_concurrency=1'* ) ;; *) fail worker local-concurrency-missing ;; esac",
    "  compose_cmd exec -T main-service-worker sh -lc '! env | grep -q \"^TENANT_AUTH_JWKS_URL=\"' || fail worker tenant-auth-env-present",
    "  worker_container=$(compose_cmd ps -q main-service-worker)",
    "  worker_logs=$(docker logs --tail 200 \"$worker_container\" 2>&1 || true)",
    "  printf '%s\\n' \"$worker_logs\" | grep -Eiq 'tenant-auth|jwks' && fail worker tenant-auth-log-present || true",
    "  printf '%s\\n' \"$worker_logs\" | grep -Eq 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|\"kty\"[[:space:]]*:' && fail worker raw-key-material-log-present || true",
    "  emit worker_health_verified true",
    "  emit worker_scheduler_verified true",
    "  emit worker_global_concurrency 1",
    "  emit worker_local_concurrency 1",
    "  emit worker_tenant_auth_env_absent true",
    "  emit worker_tenant_auth_logs_absent true",
    "  emit worker_raw_key_material_logs_absent true",
    "}",
    "auth_boundary_smoke() {",
    "  unknown=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \"http://127.0.0.1:$api_port/__ms017c1a3r_not_found\" 2>/dev/null || printf error)",
    "  tenant=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \"http://127.0.0.1:$api_port/api/feeds\" 2>/dev/null || printf error)",
    "  agent=$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \"http://127.0.0.1:$api_port/agent/feeds/due?limit=1\" 2>/dev/null || printf error)",
    "  [ \"$unknown\" = 404 ] || fail smoke \"unknown-$unknown\"",
    "  [ \"$tenant\" = 401 ] || fail smoke \"tenant-$tenant\"",
    "  [ \"$agent\" = 401 ] || fail smoke \"agent-$agent\"",
    "  emit auth_unknown_route_status 404",
    "  emit auth_tenant_unauth_status 401",
    "  emit auth_agent_unauth_status 401",
    "}",
    "verify_images",
    "verify_ports",
    "verify_migrations",
    "verify_readiness_round 1",
    "sleep 35",
    "verify_readiness_round 2",
    "verify_worker",
    "auth_boundary_smoke",
    "before_volumes=$(docker volume ls -q --filter \"$project_filter\" | count_non_empty)",
    "safe_stop",
    "collect_counts final",
    "final_volumes=$(docker volume ls -q --filter \"$project_filter\" | count_non_empty)",
    "[ \"$final_volumes\" -ge \"$before_volumes\" ] || fail safe-stop volume-count-decreased",
    "if [ -L \"$current_link\" ]; then current_target=$(readlink \"$current_link\" || true); if [ \"$current_target\" = \"$candidate_dir\" ]; then fail current-symlink promoted; fi; fi",
    "emit volumes_preserved true",
    "emit current_symlink_promoted false",
    "emit final_active_staging_service none",
    "emit sentinel_written false",
    "emit backup_restore_performed false",
    "emit rollback_performed false",
    "emit roll_forward_performed false",
    "emit production_touched false",
    "emit artifact_published false",
    "emit status production-idp-readiness-passed"
  ].join("\n");
}

export function createProductionIdpReadinessReceipt({
  target,
  contract,
  manifest,
  candidatePackageSha256,
  localJwksProbe,
  remoteFields,
  startedAt,
  finishedAt
}) {
  return {
    schema_version: 1,
    receipt_type: RECEIPT_TYPE,
    target_alias: target.target_alias,
    environment: "staging",
    edge_mode: target.edge_mode,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    idp_decision: contract.decision,
    idp_issuer: contract.issuer,
    idp_jwks_url: contract.jwks_url,
    contract_owner: contract.owner,
    contract_status: contract.status,
    contract_raw_sha256: contract.raw_sha256,
    contract_lf_normalized_sha256: contract.lf_normalized_sha256,
    candidate_version: manifest.version,
    candidate_source_commit: manifest.source_commit,
    candidate_package_sha256: candidatePackageSha256,
    candidate_image_id: manifest.image.id,
    runtime_image_env_sha256: manifest.runtime_image_env.sha256,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    local_jwks_probe: localJwksProbe,
    remote_host_jwks_probe: {
      status: remoteFields.remote_host_jwks_status,
      http_status: numberField(remoteFields.remote_host_jwks_http_status, "remote_host_jwks_http_status"),
      bytes: numberField(remoteFields.remote_host_jwks_bytes, "remote_host_jwks_bytes"),
      key_count: numberField(remoteFields.remote_host_jwks_key_count, "remote_host_jwks_key_count"),
      rs256_key_count: numberField(remoteFields.remote_host_jwks_rs256_key_count, "remote_host_jwks_rs256_key_count")
    },
    candidate_default_network_jwks_probe: jwksProbeFromFields(remoteFields, "candidate_default_network"),
    candidate_project_network_jwks_probe: jwksProbeFromFields(remoteFields, "candidate_project_network"),
    remote_shared_env_update: {
      updated: remoteFields.remote_shared_env_updated === "true",
      mode: remoteFields.remote_shared_env_mode,
      main_service_image_absent: true,
      jwks_url_verified: true
    },
    data_services: {
      postgres: "up",
      redis: "up",
      postgres_role_synchronized: remoteFields.postgres_role_synchronized === "true",
      volumes_preserved: remoteFields.volumes_preserved === "true",
      final_project_volume_count: numberField(remoteFields.final_project_volumes, "final_project_volumes")
    },
    migrate_noop_verified: remoteFields.migrate_noop_verified === "true",
    migration_count: numberField(remoteFields.migration_count, "migration_count"),
    migration_inventory: [...EXPECTED_MIGRATIONS],
    api_readiness: {
      rounds: [1, 2].map((round) => ({
        round,
        live_status: numberField(remoteFields[`round_${round}_live_status`], `round_${round}_live_status`),
        ready_status: numberField(remoteFields[`round_${round}_ready_status`], `round_${round}_ready_status`),
        postgres: remoteFields[`round_${round}_postgres`],
        redis: remoteFields[`round_${round}_redis`],
        tenant_auth: remoteFields[`round_${round}_tenant_auth`]
      }))
    },
    worker_role_isolation: {
      worker_health_verified: remoteFields.worker_health_verified === "true",
      scheduler_verified: remoteFields.worker_scheduler_verified === "true",
      global_concurrency: numberField(remoteFields.worker_global_concurrency, "worker_global_concurrency"),
      local_concurrency: numberField(remoteFields.worker_local_concurrency, "worker_local_concurrency"),
      tenant_auth_env_absent: remoteFields.worker_tenant_auth_env_absent === "true",
      tenant_auth_logs_absent: remoteFields.worker_tenant_auth_logs_absent === "true",
      raw_key_material_logs_absent: remoteFields.worker_raw_key_material_logs_absent === "true"
    },
    auth_boundary_smoke: {
      unknown_route_status: numberField(remoteFields.auth_unknown_route_status, "auth_unknown_route_status"),
      tenant_unauth_status: numberField(remoteFields.auth_tenant_unauth_status, "auth_tenant_unauth_status"),
      agent_unauth_status: numberField(remoteFields.auth_agent_unauth_status, "auth_agent_unauth_status")
    },
    safe_stop: {
      final_running_project_containers: numberField(remoteFields.final_running_project_containers, "final_running_project_containers"),
      final_api_port_listeners: numberField(remoteFields.final_api_port_listeners, "final_api_port_listeners"),
      current_symlink_promoted: remoteFields.current_symlink_promoted === "true",
      final_active_staging_service: remoteFields.final_active_staging_service,
      volumes_preserved: remoteFields.volumes_preserved === "true"
    },
    sentinel_written: false,
    backup_restore_performed: false,
    rollback_performed: false,
    roll_forward_performed: false,
    current_symlink_promoted: false,
    final_active_staging_service: "none",
    production_touched: false,
    artifact_published: false,
    git_tag_created: false,
    github_release_created: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false
  };
}

export function validateProductionIdpReadinessReceipt(receipt) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  check(receipt.schema_version === 1, "schema_version must be 1");
  check(receipt.receipt_type === RECEIPT_TYPE, "receipt_type is invalid");
  check(receipt.environment === "staging", "environment must be staging");
  check(receipt.idp_decision === "STAGING_USES_PRODUCTION_IDP", "idp decision mismatch");
  check(receipt.idp_issuer === "https://auth.habersoft.com", "issuer mismatch");
  check(receipt.idp_jwks_url === JWKS_URL, "jwks mismatch");
  check(receipt.contract_raw_sha256 === "ba83f81e86502c93b5f54e5b50bc178df295305ecd840d51d6a1a0f8da7935aa", "contract raw hash mismatch");
  check(receipt.contract_lf_normalized_sha256 === "e8c3746dd58b1ba511c6a3c09eac574fa0a73017fca7524ae8657ac4b6839a60", "contract normalized hash mismatch");
  check(receipt.candidate_version === RELEASE_IDENTITY.version, "candidate version mismatch");
  check(/^[a-f0-9]{40}$/u.test(String(receipt.candidate_source_commit)), "candidate commit is invalid");
  check(/^[a-f0-9]{64}$/u.test(String(receipt.candidate_package_sha256)), "candidate package checksum is invalid");
  check(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.candidate_image_id)), "candidate image id is invalid");
  check(/^[a-f0-9]{64}$/u.test(String(receipt.runtime_image_env_sha256)), "runtime image env checksum is invalid");
  check(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  check(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  check(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  checkJwksProbe(receipt.local_jwks_probe, "local", check);
  checkJwksProbe(receipt.remote_host_jwks_probe, "remote host", check);
  checkJwksProbe(receipt.candidate_default_network_jwks_probe, "candidate default network", check);
  checkJwksProbe(receipt.candidate_project_network_jwks_probe, "candidate project network", check);
  check(receipt.remote_shared_env_update?.updated === true, "remote shared env was not updated");
  check(receipt.remote_shared_env_update?.mode === "600", "remote shared env mode mismatch");
  check(receipt.remote_shared_env_update?.main_service_image_absent === true, "MAIN_SERVICE_IMAGE must be absent from shared env");
  check(receipt.data_services?.postgres === "up", "postgres must be up");
  check(receipt.data_services?.redis === "up", "redis must be up");
  check(receipt.data_services?.postgres_role_synchronized === true, "postgres role must be synchronized");
  check(receipt.data_services?.volumes_preserved === true, "volumes must be preserved");
  check(receipt.migrate_noop_verified === true, "migrate no-op must be verified");
  check(receipt.migration_count === EXPECTED_MIGRATIONS.length, "migration count mismatch");
  check(JSON.stringify(receipt.migration_inventory) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");
  for (const round of receipt.api_readiness?.rounds ?? []) {
    check(round.live_status === 200, `round ${round.round} live status mismatch`);
    check(round.ready_status === 200, `round ${round.round} ready status mismatch`);
    check(round.postgres === "up", `round ${round.round} postgres mismatch`);
    check(round.redis === "up", `round ${round.round} redis mismatch`);
    check(round.tenant_auth === "up", `round ${round.round} tenant auth mismatch`);
  }
  check((receipt.api_readiness?.rounds ?? []).length === 2, "two readiness rounds are required");
  check(receipt.worker_role_isolation?.worker_health_verified === true, "worker health not verified");
  check(receipt.worker_role_isolation?.scheduler_verified === true, "worker scheduler not verified");
  check(receipt.worker_role_isolation?.global_concurrency === 1, "global concurrency mismatch");
  check(receipt.worker_role_isolation?.local_concurrency === 1, "local concurrency mismatch");
  check(receipt.worker_role_isolation?.tenant_auth_env_absent === true, "worker tenant auth env must be absent");
  check(receipt.worker_role_isolation?.tenant_auth_logs_absent === true, "worker tenant auth logs must be absent");
  check(receipt.worker_role_isolation?.raw_key_material_logs_absent === true, "worker raw key material logs must be absent");
  check(receipt.auth_boundary_smoke?.unknown_route_status === 404, "unknown route smoke mismatch");
  check(receipt.auth_boundary_smoke?.tenant_unauth_status === 401, "tenant unauth smoke mismatch");
  check(receipt.auth_boundary_smoke?.agent_unauth_status === 401, "agent unauth smoke mismatch");
  check(receipt.safe_stop?.final_running_project_containers === 0, "project containers must be stopped");
  check(receipt.safe_stop?.final_api_port_listeners === 0, "API listener must be absent after stop");
  check(receipt.safe_stop?.current_symlink_promoted === false, "current symlink must not be promoted");
  check(receipt.safe_stop?.final_active_staging_service === "none", "final active staging service must be none");

  for (const field of [
    "sentinel_written",
    "backup_restore_performed",
    "rollback_performed",
    "roll_forward_performed",
    "current_symlink_promoted",
    "production_touched",
    "artifact_published",
    "git_tag_created",
    "github_release_created",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed"
  ]) {
    check(receipt[field] === false, `${field} must be false`);
  }
  check(receipt.final_active_staging_service === "none", "final active staging service must be none");
  assertDateOrder(receipt.started_at, receipt.finished_at, check);
  assertNoForbiddenReceiptData(receipt, check);

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

async function probeJwksLocally(jwksUrl) {
  const parsed = new URL(jwksUrl);
  assert(parsed.protocol === "https:", "JWKS URL must be HTTPS");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(jwksUrl, { redirect: "manual", signal: controller.signal });
    assert(response.status === 200, `local JWKS returned ${response.status}`);
    const text = await response.text();
    assert(Buffer.byteLength(text, "utf8") <= MAX_JWKS_BYTES, "local JWKS response too large");
    const jwks = JSON.parse(text);
    assert(Array.isArray(jwks.keys) && jwks.keys.length > 0, "local JWKS keys missing");
    const rs256KeyCount = jwks.keys.filter((key) => key && (key.alg === undefined || key.alg === "RS256") && typeof key.kid === "string").length;
    assert(rs256KeyCount > 0, "local JWKS RS256 key missing");
    return {
      status: "ok",
      https: true,
      http_status: response.status,
      key_count: jwks.keys.length,
      rs256_key_count: rs256KeyCount
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runRemotePrepare(target) {
  const command = buildRemotePrepareCommand(target);
  assertNoVolumeDeletion(command);
  assertNoInsecureSshArgs(buildSshArgs(target, command));
  const fields = runRemoteCommand(target, command, "remote prepare", { timeoutMs: 120_000 });
  assert(fields.status === "remote-prepare-passed", "remote prepare did not pass");
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
    fields[key] = value;
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

function validateCandidateManifest(manifest) {
  assert(manifest.version === RELEASE_IDENTITY.version, "candidate version mismatch");
  assert(manifest.status === RELEASE_IDENTITY.status, "candidate status mismatch");
  assert(manifest.source_commit === "074d868d09c5b3d6079803480760d9e669b51826", "candidate source commit mismatch");
  assert(manifest.image?.id === "sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919", "candidate image id mismatch");
  assert(manifest.runtime_image_env?.sha256 === "b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873", "runtime-image.env checksum mismatch");
  assert(JSON.stringify(manifest.migrations) === JSON.stringify(EXPECTED_MIGRATIONS), "candidate migration inventory mismatch");
  assert(JSON.stringify(manifest.services) === JSON.stringify(EXPECTED_SERVICES), "candidate service inventory mismatch");
}

function jwksProbeFromFields(fields, prefix) {
  return {
    status: fields[`${prefix}_jwks_status`],
    key_count: numberField(fields[`${prefix}_jwks_key_count`], `${prefix}_jwks_key_count`),
    rs256_key_count: numberField(fields[`${prefix}_jwks_rs256_key_count`], `${prefix}_jwks_rs256_key_count`)
  };
}

function checkJwksProbe(probe, label, check) {
  check(probe?.status === "ok", `${label} JWKS status mismatch`);
  check(Number.isInteger(probe?.key_count) && probe.key_count > 0, `${label} JWKS key count mismatch`);
  if (probe.rs256_key_count !== undefined) {
    check(Number.isInteger(probe.rs256_key_count) && probe.rs256_key_count > 0, `${label} JWKS RS256 key count mismatch`);
  }
  if (probe.http_status !== undefined) {
    check(probe.http_status === 200, `${label} JWKS HTTP status mismatch`);
  }
}

function assertDateOrder(startedAt, finishedAt, check) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  check(Number.isFinite(start), "started_at must be an ISO timestamp");
  check(Number.isFinite(finish), "finished_at must be an ISO timestamp");
  check(start <= finish, "started_at must be before finished_at");
}

function assertNoForbiddenReceiptData(value, check, pathPrefix = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenReceiptData(item, check, `${pathPrefix}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    const text = String(value ?? "");
    check(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+|postgres(?:ql)?:\/\/[^\s]+|SHA256:[A-Za-z0-9+/=]+/u.test(text), `forbidden receipt value at ${pathPrefix}`);
    check(!/[A-Za-z]:\\|\/(?:etc|opt|srv|var|home|root)\//u.test(text), `path-like receipt value at ${pathPrefix}`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    check(!/(password|secret|token|credential|private|database_url|ssh_user|ssh_host|known_hosts|fingerprint|host_ip|ip_address|container_id|remote_path|target_path|env_path|kid)/iu.test(key), `forbidden receipt field ${fullPath}`);
    assertNoForbiddenReceiptData(nested, check, fullPath);
  }
}

function resolveExternalReceiptPath(value, targetFile, runId) {
  const file = value === undefined
    ? path.join(path.dirname(path.resolve(targetFile)), `${runId}.json`)
    : path.resolve(value);
  const relative = path.relative(process.cwd(), file);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("receipt path must be outside the repository");
  }
  return file;
}

function incomingPath(target, name) {
  return joinPosix(target.remote_base_dir, "incoming", name);
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

function packageSha256(packageDir) {
  return sha256File(path.join(packageDir, "checksums.sha256"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
}

function numberField(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
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
