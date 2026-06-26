import { readFileSync } from "node:fs";
import path from "node:path";
import { RELEASE_IDENTITY } from "../release-identity.mjs";
import { optionalContractProjection } from "./idp-contract-policy.mjs";

const required = [
  "schema_version",
  "target_alias",
  "environment",
  "application_version",
  "master_release",
  "master_hash",
  "master_count",
  "target_schema_valid",
  "operator_approved",
  "env_schema_valid",
  "secrets_present",
  "known_hosts_file_present",
  "known_hosts_entry_present",
  "host_key_trust_confirmed_by_tool",
  "remote_environment_marker_configured",
  "remote_environment_marker_verified",
  "remote_contact_performed",
  "remote_mutation_performed",
  "deployment_performed",
  "image_identity_ready",
  "ready_for_read_only_remote_preflight",
  "created_at"
];
const optional = [
  "idp_contract_present",
  "idp_contract_verified",
  "idp_contract_decision",
  "idp_contract_owner",
  "idp_contract_environment",
  "idp_contract_consumer",
  "idp_contract_status",
  "idp_contract_issuer",
  "idp_contract_jwks",
  "idp_contract_audience",
  "idp_contract_scope",
  "idp_contract_algorithm",
  "idp_contract_token_acquisition_owner",
  "idp_contract_raw_sha256",
  "idp_contract_lf_normalized_sha256",
  "idp_contract_raw_hash_match",
  "idp_contract_normalized_hash_match",
  "idp_contract_authorization_scope"
];
const allowedReadinessFields = new Set([...required, ...optional]);

export function createReadinessReceipt(target, checks) {
  const idpContract = optionalContractProjection(checks.idpContract);
  return {
    schema_version: 1,
    target_alias: target.target_alias,
    environment: "staging",
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    target_schema_valid: checks.targetSchemaValid === true,
    operator_approved: target.approved === true,
    env_schema_valid: checks.envSchemaValid === true,
    secrets_present: checks.secretsPresent === true,
    known_hosts_file_present: checks.knownHostsFilePresent === true,
    known_hosts_entry_present: checks.knownHostsEntryPresent === true,
    host_key_trust_confirmed_by_tool: false,
    remote_environment_marker_configured: checks.remoteEnvironmentMarkerConfigured === true,
    remote_environment_marker_verified: false,
    remote_contact_performed: false,
    remote_mutation_performed: false,
    deployment_performed: false,
    image_identity_ready: checks.imageIdentityReady === true,
    idp_contract_present: idpContract.contract_present,
    idp_contract_verified: idpContract.contract_verified,
    idp_contract_decision: idpContract.decision,
    idp_contract_owner: idpContract.owner,
    idp_contract_environment: idpContract.environment,
    idp_contract_consumer: idpContract.consumer,
    idp_contract_status: idpContract.status,
    idp_contract_issuer: idpContract.issuer,
    idp_contract_jwks: idpContract.jwks_url,
    idp_contract_audience: idpContract.audience,
    idp_contract_scope: idpContract.scope,
    idp_contract_algorithm: idpContract.algorithm,
    idp_contract_token_acquisition_owner: idpContract.token_acquisition_owner ?? null,
    idp_contract_raw_sha256: idpContract.raw_sha256,
    idp_contract_lf_normalized_sha256: idpContract.lf_normalized_sha256,
    idp_contract_raw_hash_match: idpContract.raw_hash_match,
    idp_contract_normalized_hash_match: idpContract.normalized_hash_match,
    idp_contract_authorization_scope: idpContract.authorization_scope,
    ready_for_read_only_remote_preflight:
      checks.targetSchemaValid === true &&
      target.approved === true &&
      checks.envSchemaValid === true &&
      checks.secretsPresent === true &&
      checks.knownHostsFilePresent === true &&
      checks.knownHostsEntryPresent === true &&
      checks.remoteEnvironmentMarkerConfigured === true,
    created_at: new Date().toISOString()
  };
}

export function loadReadinessReceipt(file) {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"));
}

export function validateReadinessReceipt(receipt) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  for (const field of required) {
    assert(Object.hasOwn(receipt, field), `readiness receipt missing ${field}`);
  }
  assert(receipt.schema_version === 1, "schema_version must be 1");
  assert(receipt.environment === "staging", "environment must be staging");
  assert(receipt.application_version === RELEASE_IDENTITY.version, "application version mismatch");
  assert(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  assert(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  assert(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  assert(receipt.host_key_trust_confirmed_by_tool === false, "tool must not claim host-key trust");
  assert(receipt.remote_environment_marker_verified === false, "tool must not claim remote marker verification");
  assert(receipt.remote_contact_performed === false, "tool must not claim remote contact");
  assert(receipt.remote_mutation_performed === false, "tool must not claim remote mutation");
  assert(receipt.deployment_performed === false, "tool must not claim deployment");
  assert(Number.isFinite(Date.parse(receipt.created_at)), "created_at must be an ISO timestamp");
  assertNoForbiddenData(receipt, assert);

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

function assertNoForbiddenData(value, assert, pathPrefix = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenData(item, assert, `${pathPrefix}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    const text = String(value ?? "");
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+|postgres(?:ql)?:\/\/[^\s]+|AKIA[0-9A-Z]{16}/u.test(text), `secret-like readiness value at ${pathPrefix}`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    assert(
      allowedReadinessFields.has(fullPath) || !/(password|secret|token|credential|private|database_url|ssh_host|ssh_user|known_hosts|host_ip|ip_address|fingerprint|path|url)/iu.test(key),
      `forbidden readiness field ${fullPath}`
    );
    assertNoForbiddenData(nested, assert, fullPath);
  }
}
