import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RELEASE_IDENTITY } from "../release-identity.mjs";
import { loadEnvFile, validateStagingEnv } from "./env-inputs.mjs";
import { inspectKnownHostsForTarget } from "./known-hosts.mjs";
import { loadAndValidateTargetConfig } from "./target-config.mjs";
import { assertNoInsecureSshArgs, buildSshArgs, posixSingleQuote, runSsh } from "./ssh-client.mjs";

const PREFLIGHT_RECEIPT_TYPE = "remote-staging-readonly-preflight";
const PREFLIGHT_COMPARISON_TYPE = "remote-staging-readonly-preflight-comparison";
const CLOCK_SKEW_LIMIT_SECONDS = 30;

const passProjectStates = new Set(["absent", "existing-approved-staging"]);
const passApiPortStates = new Set(["available", "occupied-by-approved-staging-loopback"]);
const passBaseDirStates = new Set(["absent-parent-ready", "existing-empty-approved", "existing-approved-staging"]);
const passFilesystemStates = new Set(["read-write", "write-predicate-recorded"]);

export function runRemotePreflight(args) {
  const targetFile = requiredFile(args.target, "target");
  const envFile = requiredFile(args["env-file"], "env-file");
  const target = loadAndValidateTargetConfig(targetFile);
  const env = loadEnvFile(envFile);
  validateStagingEnv(env, target, "deployment-ready", { idpContractFile: args["idp-contract"] });
  inspectKnownHostsForTarget(target);

  const remoteCommand = buildRemotePreflightCommand(target);
  assertReadOnlyRemoteCommand(remoteCommand);
  assertNoInsecureSshArgs(buildSshArgs(target, remoteCommand));

  const startedAt = new Date();
  const localBeforeMs = Date.now();
  const sshResult = runSsh(target, remoteCommand, { timeoutMs: 120_000 });
  const localAfterMs = Date.now();
  const finishedAt = new Date();
  const fields = parseRemotePreflightOutput(sshResult.stdout);

  if (sshResult.status !== 0) {
    const failureStage = safeIdentifier(fields.failure_stage ?? "ssh");
    const failureReason = safeIdentifier(fields.failure_reason ?? "remote-command-failed");
    throw new Error(`remote preflight failed at ${failureStage}: ${failureReason}`);
  }

  const receipt = createPreflightReceipt({
    target,
    startedAt,
    finishedAt,
    localBeforeMs,
    localAfterMs,
    fields
  });
  validatePreflightReceipt(receipt);

  const receiptFile = resolveExternalReceiptPath(args.receipt, targetFile, receipt.run_id);
  writeJson(receiptFile, receipt, 0o644);
  return { receipt, receiptFile };
}

export function buildRemotePreflightCommand(target) {
  const remoteBaseDir = normalizePosixPath(target.remote_base_dir);
  const remoteParentDir = posixParentDir(remoteBaseDir);
  return [
    "set -eu",
    `marker_path=${posixSingleQuote(target.remote_environment_marker_path)}`,
    `marker_expected=${posixSingleQuote(target.remote_environment_marker_value)}`,
    `base_dir=${posixSingleQuote(remoteBaseDir)}`,
    `parent_dir=${posixSingleQuote(remoteParentDir)}`,
    `compose_project=${posixSingleQuote(target.compose_project_name)}`,
    `api_port=${posixSingleQuote(String(target.api_host_port))}`,
    "emit() { printf '%s=%s\\n' \"$1\" \"$2\"; }",
    "fail_marker() { emit marker_verified false; emit failure_stage marker; emit failure_reason \"$1\"; exit 42; }",
    "if ! command -v readlink >/dev/null 2>&1; then fail_marker readlink-unavailable; fi",
    "[ -e \"$marker_path\" ] || fail_marker marker-missing",
    "[ ! -L \"$marker_path\" ] || fail_marker marker-symlink",
    "[ -f \"$marker_path\" ] || fail_marker marker-not-regular",
    "[ -r \"$marker_path\" ] || fail_marker marker-not-readable",
    "marker_resolved=$(readlink -f \"$marker_path\" 2>/dev/null) || fail_marker marker-unresolved",
    "[ \"$marker_resolved\" = \"$marker_path\" ] || fail_marker marker-resolves-elsewhere",
    "marker_value=$(cat \"$marker_path\") || fail_marker marker-unreadable",
    "[ \"$marker_value\" = \"$marker_expected\" ] || fail_marker marker-mismatch",
    "emit marker_verified true",
    "emit remote_epoch \"$(date -u +%s)\"",
    "emit remote_os \"$(uname -s)\"",
    "emit uname_machine \"$(uname -m)\"",
    "if hostname >/dev/null 2>&1; then emit hostname_observed true; else emit hostname_observed false; fi",
    "remote_uid=$(id -u 2>/dev/null || printf unknown)",
    "if [ \"$remote_uid\" = 0 ]; then emit remote_user_class root; else emit remote_user_class non-root; fi",
    "count_non_empty() { count=0; while IFS= read -r line; do if [ -n \"$line\" ]; then count=$((count + 1)); fi; done; printf '%s\\n' \"$count\"; }",
    "docker_count() { docker_output=$(docker \"$@\" 2>/dev/null) || { printf 'error\\n'; return; }; printf '%s\\n' \"$docker_output\" | count_non_empty; }",
    "collect_inventory() {",
    "  prefix=$1",
    "  project_filter=\"label=com.docker.compose.project=$compose_project\"",
    "  container_total=$(docker_count ps -a --filter \"$project_filter\" --format '{{.ID}}')",
    "  container_running=$(docker_count ps --filter \"$project_filter\" --format '{{.ID}}')",
    "  published_count=$(docker_count ps -a --filter \"$project_filter\" --filter \"publish=$api_port\" --format '{{.ID}}')",
    "  volume_count=$(docker_count volume ls -q --filter \"$project_filter\")",
    "  network_count=$(docker_count network ls -q --filter \"$project_filter\")",
    "  image_count=$(docker_count image ls --filter \"$project_filter\" --format '{{.ID}}')",
    "  if [ \"$prefix\" = before ]; then",
    "    before_project_container_total=$container_total",
    "    before_project_container_running=$container_running",
    "    before_project_published_count=$published_count",
    "    before_project_volume_count=$volume_count",
    "    before_project_network_count=$network_count",
    "    before_project_image_count=$image_count",
    "  fi",
    "  emit \"${prefix}_project_container_total\" \"$container_total\"",
    "  emit \"${prefix}_project_container_running\" \"$container_running\"",
    "  emit \"${prefix}_project_published_count\" \"$published_count\"",
    "  emit \"${prefix}_project_volume_count\" \"$volume_count\"",
    "  emit \"${prefix}_project_network_count\" \"$network_count\"",
    "  emit \"${prefix}_project_image_count\" \"$image_count\"",
    "  scan_port \"$prefix\"",
    "  classify_base \"$prefix\"",
    "}",
    "scan_port() {",
    "  prefix=$1",
    "  if ! command -v ss >/dev/null 2>&1; then",
    "    emit \"${prefix}_port_probe\" unknown; emit \"${prefix}_port_listener_count\" unknown; emit \"${prefix}_port_loopback_count\" unknown; emit \"${prefix}_port_wildcard_count\" unknown; emit \"${prefix}_port_other_count\" unknown; return",
    "  fi",
    "  ss_output=$(ss -H -ltn \"sport = :$api_port\" 2>/dev/null) || { emit \"${prefix}_port_probe\" error; emit \"${prefix}_port_listener_count\" unknown; emit \"${prefix}_port_loopback_count\" unknown; emit \"${prefix}_port_wildcard_count\" unknown; emit \"${prefix}_port_other_count\" unknown; return; }",
    "  total=0; loopback=0; wildcard=0; other=0",
    "  while IFS=' ' read -r state recvq sendq local_addr rest; do",
    "    [ -n \"${state:-}\" ] || continue",
    "    total=$((total + 1))",
    "    case \"$local_addr\" in",
    "      127.*:*|[[]::1[]]:*|::1:*) loopback=$((loopback + 1)) ;;",
    "      0.0.0.0:*|'*':*|[[]::[]]:*|:::*) wildcard=$((wildcard + 1)) ;;",
    "      *) other=$((other + 1)) ;;",
    "    esac",
    "  done <<EOF",
    "$ss_output",
    "EOF",
    "  emit \"${prefix}_port_probe\" ok",
    "  emit \"${prefix}_port_listener_count\" \"$total\"",
    "  emit \"${prefix}_port_loopback_count\" \"$loopback\"",
    "  emit \"${prefix}_port_wildcard_count\" \"$wildcard\"",
    "  emit \"${prefix}_port_other_count\" \"$other\"",
    "}",
    "classify_base() {",
    "  prefix=$1",
    "  state=unsafe",
    "  if [ ! -e \"$parent_dir\" ]; then",
    "    state=unsafe",
    "  elif [ -L \"$parent_dir\" ] || [ ! -d \"$parent_dir\" ] || [ ! -x \"$parent_dir\" ] || [ ! -w \"$parent_dir\" ]; then",
    "    state=unsafe",
    "  elif [ ! -e \"$base_dir\" ]; then",
    "    state=absent-parent-ready",
    "  elif [ -L \"$base_dir\" ] || [ ! -d \"$base_dir\" ]; then",
    "    state=unsafe",
    "  elif [ ! -r \"$base_dir\" ] || [ ! -x \"$base_dir\" ]; then",
    "    state=conflicting",
    "  else",
    "    base_has_entries=false",
    "    for entry in \"$base_dir\"/* \"$base_dir\"/.[!.]* \"$base_dir\"/..?*; do",
    "      if [ -e \"$entry\" ]; then base_has_entries=true; break; fi",
    "    done",
    "    if [ \"$base_has_entries\" = false ]; then",
    "      state=existing-empty-approved",
    "    elif [ \"${before_project_container_total:-0}\" != 0 ] || [ \"${before_project_volume_count:-0}\" != 0 ] || [ \"${before_project_network_count:-0}\" != 0 ]; then",
    "      state=existing-approved-staging",
    "    else",
    "      state=conflicting",
    "    fi",
    "  fi",
    "  emit \"${prefix}_base_state\" \"$state\"",
    "}",
    "classify_filesystem() {",
    "  probe_path=$parent_dir",
    "  if [ -d \"$base_dir\" ]; then probe_path=$base_dir; fi",
    "  disk_available_kb=unknown",
    "  if df_output=$(df -Pk \"$probe_path\" 2>/dev/null); then",
    "    line_no=0",
    "    while IFS=' ' read -r filesystem blocks used available capacity mount rest; do",
    "      line_no=$((line_no + 1))",
    "      if [ \"$line_no\" = 2 ]; then disk_available_kb=$available; fi",
    "    done <<EOF",
    "$df_output",
    "EOF",
    "  fi",
    "  disk_free_bytes=unknown",
    "  case \"$disk_available_kb\" in ''|*[!0-9]*) disk_free_bytes=unknown ;; *) disk_free_bytes=$((disk_available_kb * 1024)) ;; esac",
    "  filesystem_state=write-predicate-recorded",
    "  filesystem_type=unknown",
    "  if command -v findmnt >/dev/null 2>&1; then",
    "    fstype_output=$(findmnt -no FSTYPE -T \"$probe_path\" 2>/dev/null || true)",
    "    options_output=$(findmnt -no OPTIONS -T \"$probe_path\" 2>/dev/null || true)",
    "    IFS= read -r filesystem_type <<EOF",
    "$fstype_output",
    "EOF",
    "    IFS= read -r mount_options <<EOF",
    "$options_output",
    "EOF",
    "    case \",$mount_options,\" in *,ro,*) filesystem_state=read-only ;; *) filesystem_state=read-write ;; esac",
    "  elif [ -w \"$probe_path\" ]; then",
    "    filesystem_state=write-predicate-recorded",
    "  else",
    "    filesystem_state=read-only",
    "  fi",
    "  emit filesystem_state \"$filesystem_state\"",
    "  emit filesystem_type \"$filesystem_type\"",
    "  emit disk_free_bytes \"$disk_free_bytes\"",
    "}",
    "collect_inventory before",
    "emit docker_version_status \"$(docker version --format '{{.Server.Version}}' >/dev/null 2>&1 && printf ok || printf error)\"",
    "emit docker_info_status \"$(docker info --format '{{.OSType}} {{.Architecture}} {{.ServerVersion}}' >/dev/null 2>&1 && printf ok || printf error)\"",
    "emit compose_version_status \"$(docker compose version --short >/dev/null 2>&1 && printf ok || printf error)\"",
    "classify_filesystem",
    "collect_inventory after"
  ].join("\n");
}

export function assertReadOnlyRemoteCommand(command) {
  const forbidden = [
    /\bssh-keyscan\b/u,
    /\bsshpass\b/u,
    /\bsudo\b/u,
    /\bmkdir\b/u,
    /\btouch\b/u,
    /\btee\b/u,
    /\bchmod\b/u,
    /\bchown\b/u,
    /\bcp\b/u,
    /\bmv\b/u,
    /\brm\b/u,
    /\bdocker\s+(?:pull|load|run|create|start|stop|restart|rm)\b/u,
    /\bdocker\s+compose\s+(?:up|down|run)\b/u,
    /\bdocker\s+volume\s+(?:create|rm)\b/u,
    /\bdocker\s+network\s+(?:create|rm)\b/u,
    /\b(?:prisma|migrate|pg_dump|pg_restore)\b/u
  ];
  for (const pattern of forbidden) {
    if (pattern.test(command)) {
      throw new Error(`remote preflight command contains forbidden token ${pattern.source}`);
    }
  }
}

export function createPreflightReceipt({ target, startedAt, finishedAt, localBeforeMs, localAfterMs, fields }) {
  const beforeInventory = inventoryFromFields(fields, "before");
  const afterInventory = inventoryFromFields(fields, "after");
  const beforeInventorySha256 = sha256(stableStringify(beforeInventory));
  const afterInventorySha256 = sha256(stableStringify(afterInventory));
  const inventoryUnchanged = beforeInventorySha256 === afterInventorySha256;
  const remoteArchitecture = mapArchitecture(fields.remote_os, fields.uname_machine);
  const projectState = classifyProjectState(beforeInventory, target);
  const apiPortState = classifyApiPortState(beforeInventory);
  const baseDirState = safeIdentifier(fields.before_base_state ?? "unknown");
  const filesystemState = safeIdentifier(fields.filesystem_state ?? "unknown");
  const diskFreeBytes = numberField(fields.disk_free_bytes, "disk_free_bytes");
  const clockSkewSeconds = clockSkewBoundSeconds(fields.remote_epoch, localBeforeMs, localAfterMs);
  const edgeCheck = classifyEdge(target.edge_mode, apiPortState);

  return {
    schema_version: 1,
    receipt_type: PREFLIGHT_RECEIPT_TYPE,
    run_id: `ms-017b-${crypto.randomUUID()}`,
    target_alias: target.target_alias,
    environment: "staging",
    approved: true,
    source_commit: gitOutput(["rev-parse", "HEAD"]),
    application_version: JSON.parse(readFileSync("package.json", "utf8")).version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    host_key_verified: true,
    environment_marker_verified: fields.marker_verified === "true",
    remote_architecture: remoteArchitecture,
    clock_skew_seconds: clockSkewSeconds,
    docker_available: fields.docker_version_status === "ok" && fields.docker_info_status === "ok",
    compose_v2_available: fields.compose_version_status === "ok",
    docker_noninteractive: fields.docker_version_status === "ok" && fields.docker_info_status === "ok",
    project_state: projectState,
    api_port_state: apiPortState,
    base_dir_state: baseDirState,
    filesystem_state: filesystemState,
    disk_free_bytes: diskFreeBytes,
    capacity_status: "recorded_for_MS-017C",
    edge_mode: target.edge_mode,
    edge_check: edgeCheck,
    before_inventory_sha256: beforeInventorySha256,
    after_inventory_sha256: afterInventorySha256,
    inventory_unchanged: inventoryUnchanged,
    remote_mutation_performed: false,
    package_transfer_performed: false,
    image_transfer_performed: false,
    deployment_performed: false,
    production_touched: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false,
    artifact_published: false,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString()
  };
}

export function validatePreflightReceipt(receipt) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  for (const field of [
    "schema_version",
    "receipt_type",
    "run_id",
    "target_alias",
    "environment",
    "approved",
    "source_commit",
    "application_version",
    "master_release",
    "master_hash",
    "master_count",
    "host_key_verified",
    "environment_marker_verified",
    "remote_architecture",
    "clock_skew_seconds",
    "docker_available",
    "compose_v2_available",
    "docker_noninteractive",
    "project_state",
    "api_port_state",
    "base_dir_state",
    "filesystem_state",
    "disk_free_bytes",
    "edge_mode",
    "edge_check",
    "before_inventory_sha256",
    "after_inventory_sha256",
    "inventory_unchanged",
    "remote_mutation_performed",
    "package_transfer_performed",
    "image_transfer_performed",
    "deployment_performed",
    "production_touched",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed",
    "artifact_published",
    "started_at",
    "finished_at"
  ]) {
    assert(Object.hasOwn(receipt, field), `preflight receipt missing ${field}`);
  }

  assert(receipt.schema_version === 1, "schema_version must be 1");
  assert(receipt.receipt_type === PREFLIGHT_RECEIPT_TYPE, "receipt_type is invalid");
  assert(receipt.environment === "staging", "environment must be staging");
  assert(receipt.approved === true, "approved must be true");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.source_commit)), "source_commit is invalid");
  assert(receipt.application_version === RELEASE_IDENTITY.version, `application_version must be ${RELEASE_IDENTITY.version}`);
  assert(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  assert(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  assert(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  assert(receipt.host_key_verified === true, "host key must be verified");
  assert(receipt.environment_marker_verified === true, "environment marker must be verified");
  assert(["linux/amd64", "linux/arm64"].includes(receipt.remote_architecture), "remote architecture is unsupported");
  assert(Number.isFinite(receipt.clock_skew_seconds) && Math.abs(receipt.clock_skew_seconds) <= CLOCK_SKEW_LIMIT_SECONDS, "clock skew exceeds limit");
  assert(receipt.docker_available === true, "Docker must be available");
  assert(receipt.compose_v2_available === true, "Docker Compose v2 must be available");
  assert(receipt.docker_noninteractive === true, "Docker must be noninteractive");
  assert(passProjectStates.has(receipt.project_state), "project state is not a pass state");
  assert(passApiPortStates.has(receipt.api_port_state), "API port state is not a pass state");
  assert(passBaseDirStates.has(receipt.base_dir_state), "base directory state is not a pass state");
  assert(passFilesystemStates.has(receipt.filesystem_state), "filesystem state is not a pass state");
  assert(Number.isSafeInteger(receipt.disk_free_bytes) && receipt.disk_free_bytes > 0, "disk free bytes must be recorded");
  assert(receipt.edge_mode === "loopback-only" || receipt.edge_mode === "https", "edge mode is invalid");
  assert(receipt.edge_mode !== "https" || receipt.edge_check === "preexisting_https_verified", "HTTPS edge check did not pass");
  assert(receipt.edge_mode !== "loopback-only" || receipt.edge_check === "not_exercised", "loopback edge check is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.before_inventory_sha256)), "before inventory hash is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.after_inventory_sha256)), "after inventory hash is invalid");
  assert(receipt.before_inventory_sha256 === receipt.after_inventory_sha256, "inventory hashes differ");
  assert(receipt.inventory_unchanged === true, "inventory must be unchanged");

  for (const field of [
    "remote_mutation_performed",
    "package_transfer_performed",
    "image_transfer_performed",
    "deployment_performed",
    "production_touched",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed",
    "artifact_published"
  ]) {
    assert(receipt[field] === false, `${field} must be false`);
  }

  assertDateOrder(receipt.started_at, receipt.finished_at, assert);
  assertNoForbiddenReceiptData(receipt, assert);

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

export function createPreflightComparison(receiptA, receiptB) {
  validatePreflightReceipt(receiptA);
  validatePreflightReceipt(receiptB);
  const stableFields = [
    "target_alias",
    "environment",
    "approved",
    "application_version",
    "master_release",
    "master_hash",
    "master_count",
    "host_key_verified",
    "environment_marker_verified",
    "remote_architecture",
    "docker_available",
    "compose_v2_available",
    "docker_noninteractive",
    "project_state",
    "api_port_state",
    "base_dir_state",
    "filesystem_state",
    "edge_mode",
    "edge_check",
    "inventory_unchanged",
    "remote_mutation_performed",
    "package_transfer_performed",
    "image_transfer_performed",
    "deployment_performed",
    "production_touched",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed",
    "artifact_published"
  ];
  const mismatched_fields = stableFields.filter((field) => JSON.stringify(receiptA[field]) !== JSON.stringify(receiptB[field]));
  const comparison = {
    schema_version: 1,
    receipt_type: PREFLIGHT_COMPARISON_TYPE,
    target_alias: receiptA.target_alias,
    run_1_complete: true,
    run_2_complete: true,
    stable_fields_match: mismatched_fields.length === 0,
    mismatched_fields,
    semantic_comparison_passed: mismatched_fields.length === 0,
    remote_mutation_performed: false,
    package_transfer_performed: false,
    image_transfer_performed: false,
    deployment_performed: false,
    production_touched: false,
    artifact_published: false,
    compared_at: new Date().toISOString()
  };
  validatePreflightComparison(comparison);
  return comparison;
}

export function validatePreflightComparison(comparison) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };
  assert(comparison.schema_version === 1, "comparison schema_version must be 1");
  assert(comparison.receipt_type === PREFLIGHT_COMPARISON_TYPE, "comparison receipt_type is invalid");
  assert(comparison.run_1_complete === true, "run 1 must be complete");
  assert(comparison.run_2_complete === true, "run 2 must be complete");
  assert(comparison.stable_fields_match === true, "stable fields must match");
  assert(Array.isArray(comparison.mismatched_fields) && comparison.mismatched_fields.length === 0, "comparison has mismatches");
  assert(comparison.semantic_comparison_passed === true, "semantic comparison must pass");
  for (const field of [
    "remote_mutation_performed",
    "package_transfer_performed",
    "image_transfer_performed",
    "deployment_performed",
    "production_touched",
    "artifact_published"
  ]) {
    assert(comparison[field] === false, `${field} must be false`);
  }
  assertNoForbiddenReceiptData(comparison, assert);
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

export function writePreflightComparison(args) {
  const first = JSON.parse(readFileSync(path.resolve(requiredString(args["receipt-a"], "receipt-a")), "utf8"));
  const second = JSON.parse(readFileSync(path.resolve(requiredString(args["receipt-b"], "receipt-b")), "utf8"));
  const comparison = createPreflightComparison(first, second);
  const output = resolveExternalReceiptPath(args.output, path.resolve(args["receipt-a"]), `comparison-${Date.now()}`);
  writeJson(output, comparison, 0o644);
  return { comparison, output };
}

export function parseRemotePreflightOutput(stdout) {
  const fields = {};
  for (const rawLine of String(stdout).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("remote preflight returned unexpected output");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[a-z0-9_]+$/u.test(key)) {
      throw new Error("remote preflight returned unsafe key");
    }
    if (Object.hasOwn(fields, key)) {
      throw new Error(`remote preflight returned duplicate key ${key}`);
    }
    fields[key] = value;
  }
  return fields;
}

function inventoryFromFields(fields, prefix) {
  const inventory = {
    project_container_total: countField(fields[`${prefix}_project_container_total`], `${prefix}_project_container_total`),
    project_container_running: countField(fields[`${prefix}_project_container_running`], `${prefix}_project_container_running`),
    project_published_count: countField(fields[`${prefix}_project_published_count`], `${prefix}_project_published_count`),
    project_volume_count: countField(fields[`${prefix}_project_volume_count`], `${prefix}_project_volume_count`),
    project_network_count: countField(fields[`${prefix}_project_network_count`], `${prefix}_project_network_count`),
    project_image_count: countField(fields[`${prefix}_project_image_count`], `${prefix}_project_image_count`),
    port_probe: safeIdentifier(fields[`${prefix}_port_probe`] ?? "unknown"),
    port_listener_count: countField(fields[`${prefix}_port_listener_count`], `${prefix}_port_listener_count`),
    port_loopback_count: countField(fields[`${prefix}_port_loopback_count`], `${prefix}_port_loopback_count`),
    port_wildcard_count: countField(fields[`${prefix}_port_wildcard_count`], `${prefix}_port_wildcard_count`),
    port_other_count: countField(fields[`${prefix}_port_other_count`], `${prefix}_port_other_count`),
    base_state: safeIdentifier(fields[`${prefix}_base_state`] ?? "unknown")
  };
  return inventory;
}

function classifyProjectState(inventory, target) {
  if (target.compose_project_name.toLowerCase().includes("production")) {
    return "production-like";
  }
  const resourceCount = inventory.project_container_total + inventory.project_volume_count + inventory.project_network_count;
  return resourceCount === 0 ? "absent" : "existing-approved-staging";
}

function classifyApiPortState(inventory) {
  if (inventory.port_probe !== "ok") {
    return "unknown";
  }
  if (inventory.port_listener_count === 0) {
    return "available";
  }
  if (inventory.port_wildcard_count > 0 || inventory.port_other_count > 0) {
    return "wildcard-or-public-listener";
  }
  if (inventory.port_loopback_count === inventory.port_listener_count && inventory.project_published_count > 0) {
    return "occupied-by-approved-staging-loopback";
  }
  return "occupied-by-unrelated-process";
}

function classifyEdge(edgeMode, apiPortState) {
  if (edgeMode === "loopback-only") {
    return apiPortState === "wildcard-or-public-listener" ? "preexisting_public_listener" : "not_exercised";
  }
  return "preexisting_https_failed";
}

function mapArchitecture(osName, machine) {
  if (osName !== "Linux") {
    return "unknown";
  }
  if (machine === "x86_64" || machine === "amd64") {
    return "linux/amd64";
  }
  if (machine === "aarch64" || machine === "arm64") {
    return "linux/arm64";
  }
  return "unknown";
}

function countField(value, name) {
  if (value === "error" || value === "unknown") {
    throw new Error(`${name} could not be read`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
}

function numberField(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} is invalid`);
  }
  return parsed;
}

function clockSkewBoundSeconds(remoteEpoch, localBeforeMs, localAfterMs) {
  const remoteSeconds = Number(remoteEpoch);
  if (!Number.isFinite(remoteSeconds)) {
    throw new Error("remote epoch is invalid");
  }
  const midpointSeconds = ((localBeforeMs + localAfterMs) / 2) / 1000;
  const halfIntervalSeconds = ((localAfterMs - localBeforeMs) / 2) / 1000;
  return Math.ceil(Math.abs(remoteSeconds - midpointSeconds) + halfIntervalSeconds);
}

function assertDateOrder(startedAt, finishedAt, assert) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  assert(Number.isFinite(start), "started_at must be an ISO timestamp");
  assert(Number.isFinite(finish), "finished_at must be an ISO timestamp");
  assert(start <= finish, "started_at must be before finished_at");
}

function assertNoForbiddenReceiptData(value, assert, pathPrefix = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenReceiptData(item, assert, `${pathPrefix}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    const text = String(value ?? "");
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+|postgres(?:ql)?:\/\/[^\s]+|SHA256:[A-Za-z0-9+/=]+/u.test(text), `forbidden receipt value at ${pathPrefix}`);
    assert(!/[A-Za-z]:\\|\/(?:etc|opt|srv|var|home|root)\//u.test(text), `path-like receipt value at ${pathPrefix}`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    assert(!/(password|secret|token|credential|private|database_url|ssh_user|ssh_host|known_hosts|fingerprint|host_ip|ip_address|container_id|remote_path|target_path|env_path)/iu.test(key), `forbidden receipt field ${fullPath}`);
    assertNoForbiddenReceiptData(nested, assert, fullPath);
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

function requiredFile(file, name) {
  const resolved = path.resolve(requiredString(file, name));
  if (!existsSync(resolved)) {
    throw new Error(`${name} must exist`);
  }
  return resolved;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizePosixPath(value) {
  return String(value).replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "") || "/";
}

function posixParentDir(value) {
  const normalized = normalizePosixPath(value);
  if (normalized === "/") {
    return "/";
  }
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function safeIdentifier(value) {
  const normalized = String(value ?? "unknown").trim();
  return /^[A-Za-z0-9_.:-]+$/u.test(normalized) ? normalized : "unsafe";
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error("git command failed while building preflight receipt");
  }
  return result.stdout.trim();
}

function writeJson(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}
