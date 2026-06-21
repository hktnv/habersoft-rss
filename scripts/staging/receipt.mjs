import { readFileSync } from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATIONS, RELEASE_IDENTITY } from "../release-identity.mjs";

const required = [
  "schema_version",
  "target_alias",
  "environment",
  "environment_marker_verified",
  "edge_mode",
  "started_at",
  "finished_at",
  "deployed_candidate_version",
  "deployed_candidate_commit",
  "candidate_package_sha256",
  "candidate_image_id",
  "previous_version",
  "previous_commit",
  "previous_package_sha256",
  "previous_image_id",
  "master_release",
  "master_hash",
  "master_count",
  "migration_inventory",
  "backup_sha256",
  "restore_verified",
  "candidate_deploy_verified",
  "rollback_verified",
  "roll_forward_verified",
  "final_active_version",
  "worker_scheduler_verified",
  "public_ports_verified",
  "production_touched",
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
  assert(/^0\.1\.0-ms-[0-9]+$/u.test(String(receipt.deployed_candidate_version)), "candidate version is invalid");
  assert(/^0\.1\.0-ms-[0-9]+$/u.test(String(receipt.previous_version)), "previous version is invalid");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.deployed_candidate_commit)), "candidate commit is invalid");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.previous_commit)), "previous commit is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.candidate_package_sha256)), "candidate package checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.previous_package_sha256)), "previous package checksum is invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.backup_sha256)), "backup checksum is invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.candidate_image_id)), "candidate image id is invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.previous_image_id)), "previous image id is invalid");
  assert(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  assert(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  assert(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  assert(JSON.stringify(receipt.migration_inventory) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");
  assert(receipt.restore_verified === true, "restore must be verified");
  assert(receipt.candidate_deploy_verified === true, "candidate deploy must be verified");
  assert(receipt.rollback_verified === true, "rollback must be verified");
  assert(receipt.roll_forward_verified === true, "roll-forward must be verified");
  assert(receipt.final_active_version === receipt.deployed_candidate_version, "final active version must be candidate");
  assert(receipt.worker_scheduler_verified === true, "worker scheduler must be verified");
  assert(receipt.public_ports_verified === true, "public ports must be verified");

  for (const field of [
    "production_touched",
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
