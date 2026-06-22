import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATIONS, RELEASE_IDENTITY } from "../release-identity.mjs";

const required = [
  "schema_version",
  "target_alias",
  "environment",
  "contract_decision",
  "contract_owner",
  "contract_raw_sha256",
  "contract_normalized_sha256",
  "application_version",
  "environment_marker_verified",
  "edge_mode",
  "started_at",
  "finished_at",
  "candidate_source_commit",
  "deployed_candidate_version",
  "deployed_candidate_commit",
  "candidate_package_sha256",
  "candidate_image_id",
  "candidate_runtime_image_env_sha256",
  "previous_version",
  "previous_source_commit",
  "previous_commit",
  "previous_package_sha256",
  "previous_image_id",
  "previous_runtime_image_env_sha256",
  "master_release",
  "master_hash",
  "master_count",
  "migration_inventory",
  "strict_preflight_passed",
  "capacity_gate_passed",
  "package_pair_compatibility_passed",
  "backup_sha256",
  "backup_verified",
  "restore_verified",
  "off_host_restore_verified",
  "candidate_first_deploy_passed",
  "candidate_initial_readiness_checks",
  "candidate_deploy_verified",
  "rollback_verified",
  "rollback_readiness_checks",
  "rollback_sentinel_preserved",
  "roll_forward_verified",
  "roll_forward_readiness_checks",
  "roll_forward_sentinel_preserved",
  "final_active_version",
  "final_active_source_commit",
  "worker_scheduler_verified",
  "sentinel_verified",
  "sentinel_alias_sha256",
  "sentinel_expected_counts",
  "current_pointer",
  "previous_pointer",
  "final_services_running",
  "public_ports_verified",
  "edge_integration",
  "production_touched",
  "artifact_published",
  "dns_changed",
  "tls_changed",
  "cyberpanel_changed",
  "external_registry_publish",
  "git_tag_created",
  "github_release_created"
];

export function loadReceipt(file) {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"));
}

export function validateReceipt(receipt) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  for (const field of required) {
    assert(Object.hasOwn(receipt, field), `receipt missing ${field}`);
  }

  assert(receipt.schema_version === 1, "schema_version must be 1");
  assert(receipt.environment === "staging", "environment must be staging");
  assert(receipt.contract_decision === "STAGING_USES_PRODUCTION_IDP", "contract decision mismatch");
  assert(typeof receipt.contract_owner === "string" && receipt.contract_owner.length > 0, "contract owner is required");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.contract_raw_sha256)), "contract raw checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.contract_normalized_sha256)), "contract normalized checksum is invalid");
  assert(receipt.application_version === RELEASE_IDENTITY.version, `application_version must be ${RELEASE_IDENTITY.version}`);
  assert(/^0\.1\.0-ms-[0-9]+$/u.test(String(receipt.deployed_candidate_version)), "candidate version is invalid");
  assert(/^0\.1\.0-ms-[0-9]+$/u.test(String(receipt.previous_version)), "previous version is invalid");
  assert(receipt.candidate_source_commit === receipt.deployed_candidate_commit, "candidate source commit mismatch");
  assert(receipt.previous_source_commit === receipt.previous_commit, "previous source commit mismatch");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.deployed_candidate_commit)), "candidate commit is invalid");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.previous_commit)), "previous commit is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.candidate_package_sha256)), "candidate package checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.previous_package_sha256)), "previous package checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.candidate_runtime_image_env_sha256)), "candidate runtime image env checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.previous_runtime_image_env_sha256)), "previous runtime image env checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.backup_sha256)), "backup checksum is invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.candidate_image_id)), "candidate image id is invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.previous_image_id)), "previous image id is invalid");
  assert(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  assert(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  assert(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  assert(JSON.stringify(receipt.migration_inventory) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");
  assert(receipt.strict_preflight_passed === true, "strict preflight must pass");
  assert(receipt.capacity_gate_passed === true, "capacity gate must pass");
  assert(receipt.package_pair_compatibility_passed === true, "package pair compatibility must pass");
  assert(receipt.backup_verified === true, "backup must be verified");
  assert(receipt.restore_verified === true, "restore must be verified");
  assert(receipt.off_host_restore_verified === true, "off-host restore must be verified");
  assert(receipt.candidate_first_deploy_passed === true, "candidate first deploy must pass");
  assert(receipt.candidate_initial_readiness_checks === 2, "candidate readiness checks must be 2");
  assert(receipt.candidate_deploy_verified === true, "candidate deploy must be verified");
  assert(receipt.rollback_verified === true, "rollback must be verified");
  assert(receipt.rollback_readiness_checks === 2, "rollback readiness checks must be 2");
  assert(receipt.rollback_sentinel_preserved === true, "rollback sentinel must be preserved");
  assert(receipt.roll_forward_verified === true, "roll-forward must be verified");
  assert(receipt.roll_forward_readiness_checks === 2, "roll-forward readiness checks must be 2");
  assert(receipt.roll_forward_sentinel_preserved === true, "roll-forward sentinel must be preserved");
  assert(receipt.final_active_version === receipt.deployed_candidate_version, "final active version must be candidate");
  assert(receipt.final_active_source_commit === receipt.deployed_candidate_commit, "final active source commit must be candidate");
  assert(receipt.worker_scheduler_verified === true, "worker scheduler must be verified");
  assert(receipt.sentinel_verified === true, "sentinel must be verified");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.sentinel_alias_sha256)), "sentinel alias checksum is invalid");
  assert(JSON.stringify(receipt.sentinel_expected_counts) === JSON.stringify({
    feeds: 1,
    site_feeds: 1,
    entries: 1,
    entry_details: 1,
    agent_feed_check_events: 1,
    agent_runtime_status: 1
  }), "sentinel expected counts mismatch");
  assert(receipt.current_pointer === "candidate", "current pointer must identify candidate");
  assert(receipt.previous_pointer === receipt.previous_version, "previous pointer must identify previous version");
  assert(receipt.final_services_running === true, "final services must remain running");
  assert(receipt.public_ports_verified === true, "public ports must be verified");
  assert(receipt.edge_integration === "not_exercised", "edge integration must not be exercised");

  for (const field of [
    "production_touched",
    "artifact_published",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed",
    "external_registry_publish",
    "git_tag_created",
    "github_release_created"
  ]) {
    assert(receipt[field] === false, `${field} must be false`);
  }

  assertDateOrder(receipt.started_at, receipt.finished_at, assert);
  assertNoSecretLikeData(receipt, assert);

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

function assertDateOrder(startedAt, finishedAt, assert) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  assert(Number.isFinite(start), "started_at must be an ISO timestamp");
  assert(Number.isFinite(finish), "finished_at must be an ISO timestamp");
  assert(start <= finish, "started_at must be before finished_at");
}

function assertNoSecretLikeData(value, assert, pathPrefix = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeData(item, assert, `${pathPrefix}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    const text = String(value ?? "");
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+|postgres(?:ql)?:\/\/[^\s]+|AKIA[0-9A-Z]{16}/u.test(text), `secret-like value at ${pathPrefix}`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    assert(!/(password|secret|token|credential|private|database_url|ssh_host|ssh_user|known_hosts|host_ip|ip_address)/iu.test(key), `secret-like receipt field ${fullPath}`);
    assertNoSecretLikeData(nested, assert, fullPath);
  }
}
