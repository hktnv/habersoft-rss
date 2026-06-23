import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { validateTargetConfig } from "./staging/target-config.mjs";
import { assertNoInsecureSshArgs, buildScpDownloadArgs, buildSshArgs, posixSingleQuote } from "./staging/ssh-client.mjs";
import {
  assertReadOnlyRemoteCommand,
  buildRemotePreflightCommand,
  createPreflightComparison,
  validatePreflightComparison,
  validatePreflightReceipt
} from "./staging/remote-preflight.mjs";
import { assertPreflightReady, buildRemoteDrillCommand, buildRemotePrepareCommand } from "./staging/remote-drill.mjs";
import {
  buildProductionIdpReadinessCommand,
  validateProductionIdpReadinessReceipt
} from "./staging/production-idp-readiness.mjs";
import { assertNoVolumeDeletion, releaseDir, switchCommands } from "./staging/remote-layout.mjs";
import { validateReceipt } from "./staging/receipt.mjs";
import { loadEnvFile, stagingEnvFromTemplate, validateStagingEnv } from "./staging/env-inputs.mjs";
import {
  CONTRACT_ERROR_CODES,
  loadVerifiedStagingIdpContract
} from "./staging/idp-contract-policy.mjs";
import { inspectKnownHostsForTarget } from "./staging/known-hosts.mjs";
import { loadReadinessReceipt, validateReadinessReceipt } from "./staging/operator-receipt.mjs";
import { compareRollbackCompatibility } from "./staging/package-pair.mjs";
import { EXPECTED_MIGRATIONS, EXPECTED_PUBLIC_ROUTES, EXPECTED_SERVICES, RELEASE_IDENTITY } from "./release-identity.mjs";
import { formatRuntimeImageEnv } from "./runtime-image-env.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-staging-tests-"));
const publicKey = "AAAAC3NzaC1lZDI1NTE5AAAAIAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB";
try {
  const knownHosts = path.join(temp, "known_hosts");
  writeKnownHosts(knownHosts);
  const valid = validTarget(knownHosts);

  assert.doesNotThrow(() => validateTargetConfig(valid));
  expectTargetFailure({ environment: "production" }, "environment");
  expectTargetFailure({ approved: false }, "approved");
  expectTargetFailure({ ssh_host: "rss.habersoft.com" }, "production hostname");
  expectTargetFailure({ ssh_host: "localhost" }, "localhost");
  expectTargetFailure({ known_hosts_file: path.join(temp, "missing") }, "known_hosts");
  expectTargetFailure({ ssh_port: 0 }, "ssh_port");
  expectTargetFailure({ remote_base_dir: "/var/lib/docker" }, "remote_base_dir");
  expectTargetFailure({ compose_project_name: "main-service-production" }, "project");
  expectTargetFailure({ api_host_port: 443 }, "api_host_port");
  expectTargetFailure({ edge_mode: "http" }, "edge_mode");
  expectTargetFailure({ edge_mode: "https", public_base_url: null }, "https url");
  expectTargetFailure({ edge_mode: "https", public_base_url: "https://rss.habersoft.com" }, "public_base_url must not be production");
  expectTargetFailure({ POSTGRES_PASSWORD: "secret" }, "secret-like field");
  expectTargetFailure({ unexpected: "value" }, "unknown target");
  expectTargetFailure({ remote_environment_marker_value: "production" }, "marker_value");

  const sshArgs = buildSshArgs(valid, `cat ${posixSingleQuote(valid.remote_environment_marker_path)}`);
  assert.doesNotThrow(() => assertNoInsecureSshArgs(sshArgs));
  assert(sshArgs.includes("BatchMode=yes"));
  assert(sshArgs.includes("StrictHostKeyChecking=yes"));
  assert(sshArgs.includes("PasswordAuthentication=no"));
  assert(sshArgs.includes("KbdInteractiveAuthentication=no"));
  assert(sshArgs.includes("PreferredAuthentications=publickey"));
  assert.throws(() => assertNoInsecureSshArgs(["-o", "StrictHostKeyChecking=no"]), /insecure|strict/u);
  assert.throws(() => assertNoInsecureSshArgs(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=NUL"]), /insecure|strict/u);
  assert.doesNotThrow(() => assertNoInsecureSshArgs(buildScpDownloadArgs(valid, "/opt/habersoft/rss-main-service-staging/backups/backup.dump", path.join(temp, "backup.dump"))));

  const remotePreflightCommand = buildRemotePreflightCommand(valid);
  assert.doesNotThrow(() => assertReadOnlyRemoteCommand(remotePreflightCommand));
  assert(remotePreflightCommand.indexOf("marker_path=") < remotePreflightCommand.indexOf("collect_inventory before"));
  assert.match(remotePreflightCommand, /docker version --format/u);
  assert.match(remotePreflightCommand, /docker compose version --short/u);
  assert.doesNotMatch(remotePreflightCommand, /\bdocker\s+(?:pull|load|run|create|start|stop|restart|rm)\b/u);
  assert.doesNotMatch(remotePreflightCommand, /\bdocker\s+compose\s+(?:up|down|run)\b/u);
  assert.throws(() => assertReadOnlyRemoteCommand(buildRemotePreflightCommand({
    ...valid,
    compose_project_name: "habersoft-rss-staging'; touch /tmp/nope; '"
  })), /forbidden token/u);

  const dir = releaseDir(valid.remote_base_dir, "0.1.0-ms-017", "a".repeat(40));
  assert(dir.includes("/releases/0.1.0-ms-017-"));
  const commands = switchCommands(valid.remote_base_dir, dir);
  assert.doesNotThrow(() => assertNoVolumeDeletion(commands));
  assert.throws(() => assertNoVolumeDeletion("docker compose down -v"), /delete volumes/u);
  const remotePrepareCommand = buildRemotePrepareCommand(valid);
  assert.match(remotePrepareCommand, /mkdir -p/u);
  assert.doesNotThrow(() => assertNoVolumeDeletion(remotePrepareCommand));
  const remoteDrillCommand = buildRemoteDrillCommand({
    target: valid,
    runId: "ms017c-11111111-1111-4111-8111-111111111111",
    previousManifest: manifest("0.1.0-ms-016", "a".repeat(40), "sha256:" + "1".repeat(64)),
    candidateManifest: manifest("0.1.0-ms-017", "b".repeat(40), "sha256:" + "2".repeat(64)),
    previousPackageSha256: "3".repeat(64),
    candidatePackageSha256: "4".repeat(64),
    previousArchiveSha256: "5".repeat(64),
    candidateArchiveSha256: "6".repeat(64),
    remoteNames: {
      previousArchive: "ms017c-previous.tar",
      candidateArchive: "ms017c-candidate.tar",
      sharedEnv: "ms017c-staging.env"
    }
  });
  assert.match(remoteDrillCommand, /docker load --input/u);
  assert.match(remoteDrillCommand, /ensure_release/u);
  assert.match(remoteDrillCommand, /create_sentinel/u);
  assert.match(remoteDrillCommand, /sentinel_alias_sha256/u);
  assert.match(remoteDrillCommand, /set_pointers "\$candidate_dir" "\$previous_dir"/u);
  assert.match(remoteDrillCommand, /runtime-image\.env/u);
  assert.match(remoteDrillCommand, /shared\/staging\.env/u);
  assert.match(remoteDrillCommand, /contains-runtime-image/u);
  assert.match(remoteDrillCommand, /--env-file "\$env_file" --env-file "\$runtime_env"/u);
  assert.match(remoteDrillCommand, /pull --policy missing postgres redis/u);
  assert.match(remoteDrillCommand, /--pull never/u);
  assert.match(remoteDrillCommand, /--wait --wait-timeout 180/u);
  assert.match(remoteDrillCommand, /--force-recreate --no-deps/u);
  assert.match(remoteDrillCommand, /pg_dump -Fc/u);
  assert.match(remoteDrillCommand, /curl --silent --show-error --max-time 5/u);
  assert.doesNotThrow(() => assertNoVolumeDeletion(remoteDrillCommand));
  assert.doesNotMatch(remoteDrillCommand, /StrictHostKeyChecking=no|sshpass|docker compose down -v|--volumes|system prune|redis-cli flush/u);

  const productionIdpCommand = buildProductionIdpReadinessCommand({
    target: valid,
    manifest: productionIdpManifest(),
    candidatePackageSha256: "b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082",
    archiveSha256: "7".repeat(64),
    remoteNames: {
      candidateArchive: "ms017c1a3r-candidate.tar",
      sharedEnv: "ms017c1a3r-staging.env"
    }
  });
  assert(productionIdpCommand.indexOf("marker_path=") < productionIdpCommand.indexOf("collect_counts before"));
  assert.match(productionIdpCommand, /https:\/\/auth\.habersoft\.com\/\.well-known\/jwks\.json/u);
  assert.match(productionIdpCommand, /probe_candidate_jwks bridge candidate_default_network/u);
  assert.match(productionIdpCommand, /probe_candidate_jwks "\$\{compose_project\}_default" candidate_project_network/u);
  assert.match(productionIdpCommand, /chmod 600 "\$shared_tmp"/u);
  assert.match(productionIdpCommand, /safe_stop/u);
  assert.match(productionIdpCommand, /worker tenant-auth-env-present/u);
  assert.doesNotThrow(() => assertNoVolumeDeletion(productionIdpCommand));
  assert.doesNotMatch(productionIdpCommand, /docker compose down -v|--volumes|system prune|redis-cli flush|pg_dump|pg_restore|ln -sfn/u);

  const receipt = validReceipt();
  assert.doesNotThrow(() => validateReceipt(receipt));
  expectReceiptFailure({ master_hash: "bad" }, "master hash");
  expectReceiptFailure({ backup_sha256: undefined }, "backup");
  expectReceiptFailure({ final_active_version: "0.1.0-ms-016" }, "final active version");
  expectReceiptFailure({ production_touched: true }, "production_touched");
  expectReceiptFailure({ token: "Bearer abc.def.ghi" }, "secret-like receipt field");
  expectReceiptFailure({ started_at: "2026-06-21T12:00:00.000Z", finished_at: "2026-06-21T11:00:00.000Z" }, "started_at");

  const preflightReceipt = validPreflightReceipt();
  assert.doesNotThrow(() => validatePreflightReceipt(preflightReceipt));
  assert.doesNotThrow(() => assertPreflightReady(preflightReceipt, valid));
  assert.doesNotThrow(() => assertPreflightReady({
    ...preflightReceipt,
    project_state: "existing-approved-staging",
    base_dir_state: "existing-approved-staging",
    project_container_total: 5,
    project_container_running: 0,
    project_published_count: 0,
    project_volume_count: 2,
    project_network_count: 1,
    api_port_listener_count: 0
  }, valid));
  assert.throws(() => assertPreflightReady({
    ...preflightReceipt,
    project_state: "existing-approved-staging",
    base_dir_state: "existing-approved-staging",
    project_container_running: 1,
    project_volume_count: 2
  }, valid), /zero running/u);
  assert.throws(() => assertPreflightReady({
    ...preflightReceipt,
    project_state: "existing-approved-staging",
    base_dir_state: "existing-approved-staging",
    project_container_running: 0,
    api_port_listener_count: 1,
    project_volume_count: 2
  }, valid), /no API listener/u);
  assert.throws(() => validatePreflightReceipt({ ...preflightReceipt, clock_skew_seconds: 31 }), /clock skew/u);
  assert.throws(() => validatePreflightReceipt({ ...preflightReceipt, api_port_state: "wildcard-or-public-listener" }), /API port/u);
  assert.throws(() => validatePreflightReceipt({ ...preflightReceipt, ssh_host: "staging.example.invalid" }), /forbidden receipt field/u);
  const preflightReceiptFile = path.join(temp, "preflight-receipt.json");
  writeFileSync(preflightReceiptFile, `${JSON.stringify(preflightReceipt, null, 2)}\n`);
  const preflightVerifyResult = runNode(["scripts/staging-deployment.mjs", "receipt:verify", "--receipt", preflightReceiptFile]);
  assert.equal(preflightVerifyResult.status, 0, preflightVerifyResult.stderr);
  assert.match(preflightVerifyResult.stdout, /staging-preflight-receipt-verify: ok/u);

  const secondPreflightReceipt = {
    ...preflightReceipt,
    run_id: "ms-017b-22222222-2222-4222-8222-222222222222",
    clock_skew_seconds: 4,
    disk_free_bytes: preflightReceipt.disk_free_bytes - 1024,
    started_at: "2026-06-21T10:03:00.000Z",
    finished_at: "2026-06-21T10:04:00.000Z"
  };
  assert.doesNotThrow(() => validatePreflightReceipt(secondPreflightReceipt));
  const comparison = createPreflightComparison(preflightReceipt, secondPreflightReceipt);
  assert.doesNotThrow(() => validatePreflightComparison(comparison));
  const secondPreflightReceiptFile = path.join(temp, "preflight-receipt-2.json");
  const comparisonFile = path.join(temp, "preflight-comparison.json");
  writeFileSync(secondPreflightReceiptFile, `${JSON.stringify(secondPreflightReceipt, null, 2)}\n`);
  const compareResult = runNode(["scripts/staging-deployment.mjs", "receipt:compare",
    "--receipt-a", preflightReceiptFile,
    "--receipt-b", secondPreflightReceiptFile,
    "--output", comparisonFile
  ]);
  assert.equal(compareResult.status, 0, compareResult.stderr);
  const comparisonVerifyResult = runNode(["scripts/staging-deployment.mjs", "receipt:verify", "--receipt", comparisonFile]);
  assert.equal(comparisonVerifyResult.status, 0, comparisonVerifyResult.stderr);
  assert.throws(() => createPreflightComparison(preflightReceipt, {
    ...secondPreflightReceipt,
    project_state: "existing-approved-staging"
  }), /stable fields/u);

  const productionIdpReceipt = validProductionIdpReadinessReceipt();
  assert.doesNotThrow(() => validateProductionIdpReadinessReceipt(productionIdpReceipt));
  assert.throws(() => validateProductionIdpReadinessReceipt({ ...productionIdpReceipt, sentinel_written: true }), /sentinel_written/u);
  assert.throws(() => validateProductionIdpReadinessReceipt({
    ...productionIdpReceipt,
    candidate_project_network_jwks_probe: { ...productionIdpReceipt.candidate_project_network_jwks_probe, status: "failed" }
  }), /candidate project network JWKS/u);
  const productionIdpReceiptFile = path.join(temp, "production-idp-readiness-receipt.json");
  writeFileSync(productionIdpReceiptFile, `${JSON.stringify(productionIdpReceipt, null, 2)}\n`);
  const productionIdpVerifyResult = runNode(["scripts/staging-deployment.mjs", "receipt:verify", "--receipt", productionIdpReceiptFile]);
  assert.equal(productionIdpVerifyResult.status, 0, productionIdpVerifyResult.stderr);
  assert.match(productionIdpVerifyResult.stdout, /production-idp-readiness-receipt-verify: ok/u);

  const previous = manifest("0.1.0-ms-016", "a".repeat(40), "sha256:" + "1".repeat(64));
  const candidate = manifest("0.1.0-ms-017", "b".repeat(40), "sha256:" + "2".repeat(64));
  assert.doesNotThrow(() => compareRollbackCompatibility(previous, candidate));
  assert.throws(() => compareRollbackCompatibility(previous, { ...candidate, master_sha256: "bad" }), /master_sha256/u);

  const validEnv = stagingEnvFromTemplate(valid, {
    postgresPassword: "p".repeat(32),
    rateLimitSecret: "r".repeat(32),
    agentKey: "a".repeat(32)
  });
  const contractFile = resolveAuthoritativeContractFile();
  const contractProjection = loadVerifiedStagingIdpContract({ idpContractFile: contractFile });
  assert.equal(contractProjection.contract_verified, true);
  assert.equal(contractProjection.raw_sha256, "ba83f81e86502c93b5f54e5b50bc178df295305ecd840d51d6a1a0f8da7935aa");
  assert.equal(contractProjection.lf_normalized_sha256, "e8c3746dd58b1ba511c6a3c09eac574fa0a73017fca7524ae8657ac4b6839a60");
  assert.equal(contractProjection.decision, "STAGING_USES_PRODUCTION_IDP");
  assert.doesNotMatch(JSON.stringify(contractProjection), /07-staging-contract|auth-habersoft-com|[A-Za-z]:\\/u);

  const contractText = readFileSync(contractFile, "utf8");
  const lfContractFile = path.join(temp, "lf-normalized-staging-contract.md");
  writeFileSync(lfContractFile, contractText.replace(/\r\n/gu, "\n"));
  const lfContractProjection = loadVerifiedStagingIdpContract({ idpContractFile: lfContractFile });
  assert.equal(lfContractProjection.raw_hash_match, false);
  assert.equal(lfContractProjection.normalized_hash_match, true);
  const tamperedContractFile = path.join(temp, "tampered-staging-contract.md");
  writeFileSync(tamperedContractFile, contractText.replace("STAGING_USES_PRODUCTION_IDP", "STAGING_USES_WRONG_IDP"));
  assert.throws(
    () => loadVerifiedStagingIdpContract({ idpContractFile: tamperedContractFile }),
    new RegExp(CONTRACT_ERROR_CODES.hashMismatch, "u")
  );

  const productionJwksEnv = {
    ...validEnv,
    TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json"
  };
  assert.throws(
    () => validateStagingEnv(productionJwksEnv, valid, "operator-input", { idpContractFile: "" }),
    new RegExp(CONTRACT_ERROR_CODES.required, "u")
  );
  const contractEnvResult = validateStagingEnv(productionJwksEnv, valid, "operator-input", { idpContractFile: contractFile });
  assert.equal(contractEnvResult.idpContract.contract_verified, true);
  assert.equal(contractEnvResult.idpContract.jwks_url, productionJwksEnv.TENANT_AUTH_JWKS_URL);
  const contractDeploymentResult = validateStagingEnv(productionJwksEnv, valid, "deployment-ready", { idpContractFile: contractFile });
  assert.equal(contractDeploymentResult.packageImageRequired, true);
  assert.equal(contractDeploymentResult.idpContract.contract_verified, true);
  assert.throws(
    () => validateStagingEnv({ ...validEnv, TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/other.json" }, valid, "operator-input", { idpContractFile: contractFile }),
    new RegExp(`${CONTRACT_ERROR_CODES.jwksMismatch}|${CONTRACT_ERROR_CODES.productionIdentifierForbidden}`, "u")
  );
  assert.throws(
    () => validateStagingEnv({ ...validEnv, TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com:444/.well-known/jwks.json" }, valid, "operator-input", { idpContractFile: contractFile }),
    new RegExp(`${CONTRACT_ERROR_CODES.jwksMismatch}|${CONTRACT_ERROR_CODES.productionIdentifierForbidden}`, "u")
  );
  assert.throws(
    () => validateStagingEnv({ ...validEnv, TENANT_AUTH_JWKS_URL: "https://auth-staging.habersoft.com/.well-known/jwks.json" }, valid),
    new RegExp(CONTRACT_ERROR_CODES.jwksMismatch, "u")
  );
  assert.throws(
    () => validateStagingEnv({ ...productionJwksEnv, BULLMQ_PREFIX: "main-service-production" }, valid, "operator-input", { idpContractFile: contractFile }),
    /BULLMQ_PREFIX|STAGING_PRODUCTION_IDENTIFIER_FORBIDDEN/u
  );
  const operatorEnvResult = validateStagingEnv(validEnv, valid, "operator-input");
  assert.equal(operatorEnvResult.imageIdentityReady, false);
  assert.equal(operatorEnvResult.legacyImageFieldPresent, false);
  const deploymentEnvResult = validateStagingEnv(validEnv, valid, "deployment-ready");
  assert.equal(deploymentEnvResult.packageImageRequired, true);
  const legacyImageEnvResult = validateStagingEnv({
    ...validEnv,
    MAIN_SERVICE_IMAGE: `sha256:${"f".repeat(64)}`
  }, valid, "deployment-ready");
  assert.equal(legacyImageEnvResult.legacyImageFieldPresent, true);
  assert.throws(() => validateStagingEnv({ ...validEnv, UNKNOWN_APP_KEY: "1" }, valid), /unknown env key/u);
  assert.throws(() => validateStagingEnv({ ...validEnv, AGENT_KEY: "CHANGE_ME_AGENT_KEY_MINIMUM_32_BYTES" }, valid), /AGENT_KEY/u);
  assert.throws(() => validateStagingEnv({ ...validEnv, TENANT_AUTH_JWKS_URL: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json" }, valid), /JWKS/u);
  assert.throws(() => validateStagingEnv({ ...validEnv, BULLMQ_PREFIX: "main-service-production" }, valid), /BULLMQ_PREFIX|production identifier/u);

  const beforeKnownHosts = readFileSync(knownHosts, "utf8");
  const inspection = inspectKnownHostsForTarget(valid);
  assert.equal(inspection.entry_found, true);
  assert.equal(inspection.key_type, "ED25519");
  assert.equal(inspection.network_contacted, false);
  assert.match(inspection.fingerprint, /^SHA256:/u);
  assert.equal(readFileSync(knownHosts, "utf8"), beforeKnownHosts);
  assert.throws(() => inspectKnownHostsForTarget({ ...valid, known_hosts_file: path.join(temp, "missing") }), /known_hosts file must exist/u);
  const wrongHostFile = path.join(temp, "wrong-known-hosts");
  writeFileSync(wrongHostFile, `other.example.invalid ssh-ed25519 ${publicKey}\n`);
  assert.throws(() => inspectKnownHostsForTarget({ ...valid, known_hosts_file: wrongHostFile }), /entry.*not found/u);
  const malformedKnownHosts = path.join(temp, "malformed-known-hosts");
  writeFileSync(malformedKnownHosts, "staging-host.example.invalid ssh-ed25519\n");
  assert.throws(() => inspectKnownHostsForTarget({ ...valid, known_hosts_file: malformedKnownHosts }), /malformed known_hosts/u);
  const nonDefaultKnownHosts = path.join(temp, "known-hosts-port");
  writeFileSync(nonDefaultKnownHosts, `[staging-host.example.invalid]:2222 ssh-ed25519 ${publicKey}\n`);
  assert.doesNotThrow(() => inspectKnownHostsForTarget({ ...valid, ssh_port: 2222, known_hosts_file: nonDefaultKnownHosts }));

  const scaffoldDir = path.join(temp, "operator-output");
  const scaffoldKnownHosts = path.join(scaffoldDir, "staging-known-hosts");
  const scaffoldResult = runNode(["scripts/staging-operator-inputs.mjs", "scaffold",
    "--output-dir", scaffoldDir,
    "--target-alias", "rss-main-service-staging-test",
    "--ssh-host", "staging.example.invalid",
    "--ssh-port", "22",
    "--ssh-user", "deploy",
    "--known-hosts-file", scaffoldKnownHosts,
    "--marker-path", "/etc/habersoft/environment",
    "--remote-base-dir", "/opt/habersoft/rss-main-service-staging-test",
    "--project-name", "habersoft-rss-staging-test",
    "--api-port", "13000",
    "--edge-mode", "loopback-only"
  ]);
  assert.equal(scaffoldResult.status, 0, scaffoldResult.stderr);
  assert.equal(existsSync(scaffoldKnownHosts), false);
  const scaffoldTarget = JSON.parse(readFileSync(path.join(scaffoldDir, "staging-target.json"), "utf8"));
  assert.equal(scaffoldTarget.approved, false);
  assert.equal(loadEnvFile(path.join(scaffoldDir, "staging.env")).MAIN_SERVICE_IMAGE, undefined);
  assert.doesNotThrow(() => validateReadinessReceipt(loadReadinessReceipt(path.join(scaffoldDir, "staging-input-readiness.json"))));
  const repeatedScaffold = runNode(["scripts/staging-operator-inputs.mjs", "scaffold",
    "--output-dir", scaffoldDir,
    "--target-alias", "rss-main-service-staging-test",
    "--ssh-host", "staging.example.invalid",
    "--ssh-port", "22",
    "--ssh-user", "deploy",
    "--known-hosts-file", scaffoldKnownHosts,
    "--marker-path", "/etc/habersoft/environment",
    "--remote-base-dir", "/opt/habersoft/rss-main-service-staging-test",
    "--project-name", "habersoft-rss-staging-test",
    "--api-port", "13000",
    "--edge-mode", "loopback-only"
  ]);
  assert.notEqual(repeatedScaffold.status, 0);
  assert.notEqual(runNode(["scripts/staging-operator-inputs.mjs", "scaffold",
    "--output-dir", path.resolve("deploy/staging/operator-output"),
    "--target-alias", "rss-main-service-staging-test",
    "--ssh-host", "staging.example.invalid",
    "--ssh-port", "22",
    "--ssh-user", "deploy",
    "--known-hosts-file", scaffoldKnownHosts,
    "--marker-path", "/etc/habersoft/environment",
    "--remote-base-dir", "/opt/habersoft/rss-main-service-staging-test",
    "--project-name", "habersoft-rss-staging-test",
    "--api-port", "13000",
    "--edge-mode", "loopback-only"
  ]).status, 0);
  assert.notEqual(runNode(["scripts/staging-operator-inputs.mjs", "scaffold",
    "--output-dir", path.join(temp, "bad-host-output"),
    "--target-alias", "rss-main-service-staging-test",
    "--ssh-host", "rss.habersoft.com",
    "--ssh-port", "22",
    "--ssh-user", "deploy",
    "--known-hosts-file", scaffoldKnownHosts,
    "--marker-path", "/etc/habersoft/environment",
    "--remote-base-dir", "/opt/habersoft/rss-main-service-staging-test",
    "--project-name", "habersoft-rss-staging-test",
    "--api-port", "13000",
    "--edge-mode", "loopback-only"
  ]).status, 0);

  const verifyDir = path.join(temp, "verify-output");
  mkdirSync(verifyDir);
  const verifyKnownHosts = path.join(verifyDir, "staging-known-hosts");
  writeKnownHosts(verifyKnownHosts, "staging.example.invalid");
  const verifyTarget = {
    ...validTarget(verifyKnownHosts),
    target_alias: "rss-main-service-staging-test",
    ssh_host: "staging.example.invalid",
    remote_base_dir: "/opt/habersoft/rss-main-service-staging-test",
    compose_project_name: "habersoft-rss-staging-test"
  };
  const verifyTargetFile = path.join(verifyDir, "staging-target.json");
  const verifyEnvFile = path.join(verifyDir, "staging.env");
  writeFileSync(verifyTargetFile, `${JSON.stringify(verifyTarget, null, 2)}\n`);
  writeFileSync(verifyEnvFile, formatTestEnv(stagingEnvFromTemplate(verifyTarget, {
    postgresPassword: "s".repeat(32),
    rateLimitSecret: "t".repeat(40),
    agentKey: "u".repeat(40)
  })));
  const verifyResult = runNode(["scripts/staging-operator-inputs.mjs", "verify", "--target", verifyTargetFile, "--env-file", verifyEnvFile]);
  assert.equal(verifyResult.status, 0, verifyResult.stderr);
  assert.equal(parseCommandJson(verifyResult.stdout, "staging-operator-inputs-verified").idp_contract_verified, false);
  const missingRuntimeResult = runNode(["scripts/staging-operator-inputs.mjs", "verify", "--target", verifyTargetFile, "--env-file", verifyEnvFile, "--mode", "deployment-ready"]);
  assert.notEqual(missingRuntimeResult.status, 0);
  assert.match(missingRuntimeResult.stderr, /runtime-image-env/u);
  const readiness = loadReadinessReceipt(path.join(verifyDir, "staging-input-readiness.json"));
  assert.equal(readiness.ready_for_read_only_remote_preflight, true);
  assert.equal(readiness.host_key_trust_confirmed_by_tool, false);
  assert.equal(readiness.remote_environment_marker_verified, false);
  assert.equal(readiness.image_identity_ready, false);
  assert.equal(readiness.idp_contract_verified, false);
  assert.doesNotThrow(() => validateReadinessReceipt(readiness));
  const verifyProductionEnvFile = path.join(verifyDir, "staging-production-idp.env");
  writeFileSync(verifyProductionEnvFile, formatTestEnv({
    ...stagingEnvFromTemplate(verifyTarget, {
      postgresPassword: "v".repeat(32),
      rateLimitSecret: "w".repeat(40),
      agentKey: "x".repeat(40)
    }),
    TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json"
  }));
  const missingContractVerify = runNode([
    "scripts/staging-operator-inputs.mjs",
    "verify",
    "--target", verifyTargetFile,
    "--env-file", verifyProductionEnvFile,
    "--idp-contract", ""
  ]);
  assert.notEqual(missingContractVerify.status, 0);
  assert.match(missingContractVerify.stderr, new RegExp(CONTRACT_ERROR_CODES.required, "u"));
  assert.doesNotMatch(missingContractVerify.stderr, /07-staging-contract|auth-habersoft-com|postgresql:\/\//u);

  const contractVerifyResult = runNode([
    "scripts/staging-operator-inputs.mjs",
    "verify",
    "--target", verifyTargetFile,
    "--env-file", verifyProductionEnvFile,
    "--idp-contract", contractFile
  ]);
  assert.equal(contractVerifyResult.status, 0, contractVerifyResult.stderr);
  const contractVerifyJson = parseCommandJson(contractVerifyResult.stdout, "staging-operator-inputs-verified");
  assert.equal(contractVerifyJson.idp_contract_verified, true);
  assert.equal(contractVerifyJson.idp_contract_raw_sha256, "ba83f81e86502c93b5f54e5b50bc178df295305ecd840d51d6a1a0f8da7935aa");
  const contractReadiness = loadReadinessReceipt(path.join(verifyDir, "staging-input-readiness.json"));
  assert.equal(contractReadiness.idp_contract_verified, true);
  assert.equal(contractReadiness.idp_contract_jwks, "https://auth.habersoft.com/.well-known/jwks.json");
  assert.doesNotMatch(JSON.stringify(contractReadiness), /07-staging-contract|auth-habersoft-com|postgresql:\/\//u);

  const runtimeImageEnvFile = path.join(verifyDir, "runtime-image.env");
  writeFileSync(runtimeImageEnvFile, formatRuntimeImageEnv(`sha256:${"b".repeat(64)}`));
  const deploymentReadyContractResult = runNode([
    "scripts/staging-operator-inputs.mjs",
    "verify",
    "--target", verifyTargetFile,
    "--env-file", verifyProductionEnvFile,
    "--mode", "deployment-ready",
    "--runtime-image-env", runtimeImageEnvFile,
    "--idp-contract", contractFile
  ]);
  assert.equal(deploymentReadyContractResult.status, 0, deploymentReadyContractResult.stderr);
  const deploymentReadyJson = parseCommandJson(deploymentReadyContractResult.stdout, "staging-operator-inputs-verified");
  assert.equal(deploymentReadyJson.image_identity_ready, true);
  assert.equal(deploymentReadyJson.package_image_required, true);
  assert.equal(deploymentReadyJson.idp_contract_verified, true);
  const inspectResult = runNode(["scripts/staging-operator-inputs.mjs", "known-hosts:inspect", "--target", verifyTargetFile]);
  assert.equal(inspectResult.status, 0, inspectResult.stderr);
  const inspectJson = JSON.parse(inspectResult.stdout);
  assert.equal(inspectJson.target_alias, "rss-main-service-staging-test");
  assert.equal(inspectJson.network_contacted, false);
  assert.match(inspectJson.fingerprint, /^SHA256:/u);
  const repoTargetVerify = runNode(["scripts/staging-operator-inputs.mjs", "verify", "--target", "deploy/staging/target.example.json", "--env-file", verifyEnvFile]);
  assert.notEqual(repoTargetVerify.status, 0);
  assert.match(repoTargetVerify.stderr, /outside the repository/u);

  console.log("test-staging: ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function validTarget(knownHosts) {
  return {
    environment: "staging",
    approved: true,
    target_alias: "rss-main-service-staging-1",
    ssh_host: "staging-host.example.invalid",
    ssh_port: 22,
    ssh_user: "deploy",
    known_hosts_file: knownHosts,
    remote_environment_marker_path: "/etc/habersoft/environment",
    remote_environment_marker_value: "staging",
    remote_base_dir: "/opt/habersoft/rss-main-service-staging",
    compose_project_name: "habersoft-rss-staging",
    api_host_port: 13000,
    edge_mode: "loopback-only",
    public_base_url: null
  };
}

function writeKnownHosts(file, host = "staging-host.example.invalid") {
  writeFileSync(file, `${host} ssh-ed25519 ${publicKey}\n`);
}

function expectTargetFailure(patch, label) {
  const knownHosts = path.join(temp, "known_hosts");
  assert.throws(() => validateTargetConfig({ ...validTarget(knownHosts), ...patch }), new RegExp(label, "iu"));
}

function validReceipt() {
  return {
    schema_version: 1,
    target_alias: "rss-main-service-staging-1",
    environment: "staging",
    contract_decision: "STAGING_USES_PRODUCTION_IDP",
    contract_owner: "Habersoft RSS Operator Ekibi",
    contract_raw_sha256: "a".repeat(64),
    contract_normalized_sha256: "b".repeat(64),
    application_version: RELEASE_IDENTITY.version,
    environment_marker_verified: true,
    edge_mode: "loopback-only",
    started_at: "2026-06-21T10:00:00.000Z",
    finished_at: "2026-06-21T11:00:00.000Z",
    candidate_source_commit: "b".repeat(40),
    deployed_candidate_version: "0.1.0-ms-017",
    deployed_candidate_commit: "b".repeat(40),
    candidate_package_sha256: "c".repeat(64),
    candidate_image_id: "sha256:" + "2".repeat(64),
    candidate_runtime_image_env_sha256: "4".repeat(64),
    previous_version: "0.1.0-ms-016",
    previous_source_commit: "a".repeat(40),
    previous_commit: "a".repeat(40),
    previous_package_sha256: "d".repeat(64),
    previous_image_id: "sha256:" + "1".repeat(64),
    previous_runtime_image_env_sha256: "5".repeat(64),
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    migration_inventory: [...EXPECTED_MIGRATIONS],
    strict_preflight_passed: true,
    capacity_gate_passed: true,
    package_pair_compatibility_passed: true,
    backup_sha256: "e".repeat(64),
    backup_verified: true,
    restore_verified: true,
    off_host_restore_verified: true,
    candidate_first_deploy_passed: true,
    candidate_initial_readiness_checks: 2,
    candidate_deploy_verified: true,
    rollback_verified: true,
    rollback_readiness_checks: 2,
    rollback_sentinel_preserved: true,
    roll_forward_verified: true,
    roll_forward_readiness_checks: 2,
    roll_forward_sentinel_preserved: true,
    final_active_version: "0.1.0-ms-017",
    final_active_source_commit: "b".repeat(40),
    worker_scheduler_verified: true,
    sentinel_verified: true,
    sentinel_alias_sha256: "6".repeat(64),
    sentinel_expected_counts: {
      feeds: 1,
      site_feeds: 1,
      entries: 1,
      entry_details: 1,
      agent_feed_check_events: 1,
      agent_runtime_status: 1
    },
    current_pointer: "candidate",
    previous_pointer: "0.1.0-ms-016",
    final_services_running: true,
    public_ports_verified: true,
    edge_integration: "not_exercised",
    production_touched: false,
    artifact_published: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false,
    external_registry_publish: false,
    git_tag_created: false,
    github_release_created: false
  };
}

function validPreflightReceipt() {
  return {
    schema_version: 1,
    receipt_type: "remote-staging-readonly-preflight",
    run_id: "ms-017b-11111111-1111-4111-8111-111111111111",
    target_alias: "rss-main-service-staging-1",
    environment: "staging",
    approved: true,
    source_commit: "a".repeat(40),
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    host_key_verified: true,
    environment_marker_verified: true,
    remote_architecture: "linux/amd64",
    clock_skew_seconds: 2,
    docker_available: true,
    compose_v2_available: true,
    docker_noninteractive: true,
    project_container_total: 0,
    project_container_running: 0,
    project_published_count: 0,
    project_volume_count: 0,
    project_network_count: 0,
    api_port_listener_count: 0,
    api_port_loopback_count: 0,
    api_port_wildcard_count: 0,
    api_port_other_count: 0,
    project_state: "absent",
    api_port_state: "available",
    base_dir_state: "absent-parent-ready",
    filesystem_state: "read-write",
    disk_free_bytes: 1024 * 1024 * 1024,
    capacity_status: "recorded_for_MS-017C",
    edge_mode: "loopback-only",
    edge_check: "not_exercised",
    before_inventory_sha256: "f".repeat(64),
    after_inventory_sha256: "f".repeat(64),
    inventory_unchanged: true,
    remote_mutation_performed: false,
    package_transfer_performed: false,
    image_transfer_performed: false,
    deployment_performed: false,
    production_touched: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false,
    artifact_published: false,
    started_at: "2026-06-21T10:00:00.000Z",
    finished_at: "2026-06-21T10:01:00.000Z"
  };
}

function expectReceiptFailure(patch, label) {
  assert.throws(() => validateReceipt({ ...validReceipt(), ...patch }), new RegExp(label, "iu"));
}

function manifest(version, commit, imageId) {
  return {
    version,
    source_commit: commit,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_sha256: RELEASE_IDENTITY.masterSha256,
    master_active_markdown_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    migrations: [...EXPECTED_MIGRATIONS],
    public_routes: [...EXPECTED_PUBLIC_ROUTES],
    services: [...EXPECTED_SERVICES],
    image: { included: true, id: imageId, reference: `main-service-app:${version}` },
    runtime_image_env: { included: true, path: "deploy/runtime-image.env", key: "MAIN_SERVICE_IMAGE", image_id: imageId, sha256: "9".repeat(64) }
  };
}

function productionIdpManifest() {
  return {
    version: RELEASE_IDENTITY.version,
    status: RELEASE_IDENTITY.status,
    source_commit: "074d868d09c5b3d6079803480760d9e669b51826",
    master_release: RELEASE_IDENTITY.masterRelease,
    master_sha256: RELEASE_IDENTITY.masterSha256,
    master_active_markdown_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    migrations: [...EXPECTED_MIGRATIONS],
    public_routes: [...EXPECTED_PUBLIC_ROUTES],
    services: [...EXPECTED_SERVICES],
    image: {
      included: true,
      id: "sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919",
      reference: "main-service-app:0.1.0-ms-017"
    },
    runtime_image_env: {
      included: true,
      path: "deploy/runtime-image.env",
      key: "MAIN_SERVICE_IMAGE",
      image_id: "sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919",
      sha256: "b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873"
    }
  };
}

function validProductionIdpReadinessReceipt() {
  return {
    schema_version: 1,
    receipt_type: "remote-production-idp-readiness-only",
    target_alias: "rss-main-service-staging-1",
    environment: "staging",
    edge_mode: "loopback-only",
    started_at: "2026-06-22T10:00:00.000Z",
    finished_at: "2026-06-22T10:02:00.000Z",
    idp_decision: "STAGING_USES_PRODUCTION_IDP",
    idp_issuer: "https://auth.habersoft.com",
    idp_jwks_url: "https://auth.habersoft.com/.well-known/jwks.json",
    contract_owner: "Habersoft RSS Operatör Ekibi",
    contract_status: "ONAYLANDI & AKTİF",
    contract_raw_sha256: "ba83f81e86502c93b5f54e5b50bc178df295305ecd840d51d6a1a0f8da7935aa",
    contract_lf_normalized_sha256: "e8c3746dd58b1ba511c6a3c09eac574fa0a73017fca7524ae8657ac4b6839a60",
    candidate_version: RELEASE_IDENTITY.version,
    candidate_source_commit: "074d868d09c5b3d6079803480760d9e669b51826",
    candidate_package_sha256: "b319c5daf031332f0a68b35774d58f537dd580cba279472a0d270b1a1c5fb082",
    candidate_image_id: "sha256:fdeb82c314b8f5af0f6e0fca572ef986d8b311449503389691950f0a4e940919",
    runtime_image_env_sha256: "b0dde9479c9fbe64c00f86cb439716207795f8f793df81c0fcb37f1bb449d873",
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    local_jwks_probe: { status: "ok", https: true, http_status: 200, key_count: 1, rs256_key_count: 1 },
    remote_host_jwks_probe: { status: "ok", http_status: 200, bytes: 442, key_count: 1, rs256_key_count: 1 },
    candidate_default_network_jwks_probe: { status: "ok", key_count: 1, rs256_key_count: 1 },
    candidate_project_network_jwks_probe: { status: "ok", key_count: 1, rs256_key_count: 1 },
    remote_shared_env_update: {
      updated: true,
      mode: "600",
      main_service_image_absent: true,
      jwks_url_verified: true
    },
    data_services: {
      postgres: "up",
      redis: "up",
      postgres_role_synchronized: true,
      volumes_preserved: true,
      final_project_volume_count: 2
    },
    migrate_noop_verified: true,
    migration_count: EXPECTED_MIGRATIONS.length,
    migration_inventory: [...EXPECTED_MIGRATIONS],
    api_readiness: {
      rounds: [1, 2].map((round) => ({
        round,
        live_status: 200,
        ready_status: 200,
        postgres: "up",
        redis: "up",
        tenant_auth: "up"
      }))
    },
    worker_role_isolation: {
      worker_health_verified: true,
      scheduler_verified: true,
      global_concurrency: 1,
      local_concurrency: 1,
      tenant_auth_env_absent: true,
      tenant_auth_logs_absent: true,
      raw_key_material_logs_absent: true
    },
    auth_boundary_smoke: {
      unknown_route_status: 404,
      tenant_unauth_status: 401,
      agent_unauth_status: 401
    },
    safe_stop: {
      final_running_project_containers: 0,
      final_api_port_listeners: 0,
      current_symlink_promoted: false,
      final_active_staging_service: "none",
      volumes_preserved: true
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

function runNode(commandArgs) {
  return spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false
  });
}

function formatTestEnv(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

function resolveAuthoritativeContractFile() {
  const candidates = [
    process.env.STAGING_IDP_CONTRACT_FILE,
    path.resolve("..", "..", "auth-habersoft-com", ".docs", "07-staging-contract.md")
  ].filter(Boolean);
  const contractFile = candidates.find((candidate) => existsSync(candidate));
  assert(contractFile !== undefined, "authoritative staging IdP contract file must exist for staging tests");
  return contractFile;
}

function parseCommandJson(stdout, status) {
  const marker = `{\n  "status": "${status}"`;
  const index = stdout.indexOf(marker);
  assert(index >= 0, `stdout did not include ${status} JSON`);
  return JSON.parse(stdout.slice(index));
}
