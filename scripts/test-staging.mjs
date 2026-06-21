import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { validateTargetConfig } from "./staging/target-config.mjs";
import { assertNoInsecureSshArgs, buildSshArgs, posixSingleQuote } from "./staging/ssh-client.mjs";
import { assertNoVolumeDeletion, releaseDir, switchCommands } from "./staging/remote-layout.mjs";
import { validateReceipt } from "./staging/receipt.mjs";
import { compareRollbackCompatibility } from "./staging/package-pair.mjs";
import { EXPECTED_MIGRATIONS, EXPECTED_PUBLIC_ROUTES, EXPECTED_SERVICES, RELEASE_IDENTITY } from "./release-identity.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-staging-tests-"));
try {
  const knownHosts = path.join(temp, "known_hosts");
  writeFileSync(knownHosts, "staging-host.example.invalid ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestOnly\n");
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

  const sshArgs = buildSshArgs(valid, `cat ${posixSingleQuote(valid.remote_environment_marker_path)}`);
  assert.doesNotThrow(() => assertNoInsecureSshArgs(sshArgs));
  assert(sshArgs.includes("BatchMode=yes"));
  assert(sshArgs.includes("StrictHostKeyChecking=yes"));
  assert.throws(() => assertNoInsecureSshArgs(["-o", "StrictHostKeyChecking=no"]), /insecure|strict/u);

  const dir = releaseDir(valid.remote_base_dir, "0.1.0-ms-017", "a".repeat(40));
  assert(dir.includes("/releases/0.1.0-ms-017-"));
  const commands = switchCommands(valid.remote_base_dir, dir);
  assert.doesNotThrow(() => assertNoVolumeDeletion(commands));
  assert.throws(() => assertNoVolumeDeletion("docker compose down -v"), /delete volumes/u);

  const receipt = validReceipt();
  assert.doesNotThrow(() => validateReceipt(receipt));
  expectReceiptFailure({ master_hash: "bad" }, "master hash");
  expectReceiptFailure({ backup_sha256: undefined }, "backup");
  expectReceiptFailure({ final_active_version: "0.1.0-ms-016" }, "final active version");
  expectReceiptFailure({ production_touched: true }, "production_touched");
  expectReceiptFailure({ token: "Bearer abc.def.ghi" }, "secret-like receipt field");
  expectReceiptFailure({ started_at: "2026-06-21T12:00:00.000Z", finished_at: "2026-06-21T11:00:00.000Z" }, "started_at");

  const previous = manifest("0.1.0-ms-016", "a".repeat(40), "sha256:" + "1".repeat(64));
  const candidate = manifest("0.1.0-ms-017", "b".repeat(40), "sha256:" + "2".repeat(64));
  assert.doesNotThrow(() => compareRollbackCompatibility(previous, candidate));
  assert.throws(() => compareRollbackCompatibility(previous, { ...candidate, master_sha256: "bad" }), /master_sha256/u);

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

function expectTargetFailure(patch, label) {
  const knownHosts = path.join(temp, "known_hosts");
  assert.throws(() => validateTargetConfig({ ...validTarget(knownHosts), ...patch }), new RegExp(label, "iu"));
}

function validReceipt() {
  return {
    schema_version: 1,
    target_alias: "rss-main-service-staging-1",
    environment: "staging",
    environment_marker_verified: true,
    edge_mode: "loopback-only",
    started_at: "2026-06-21T10:00:00.000Z",
    finished_at: "2026-06-21T11:00:00.000Z",
    deployed_candidate_version: "0.1.0-ms-017",
    deployed_candidate_commit: "b".repeat(40),
    candidate_package_sha256: "c".repeat(64),
    candidate_image_id: "sha256:" + "2".repeat(64),
    previous_version: "0.1.0-ms-016",
    previous_commit: "a".repeat(40),
    previous_package_sha256: "d".repeat(64),
    previous_image_id: "sha256:" + "1".repeat(64),
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    migration_inventory: [...EXPECTED_MIGRATIONS],
    backup_sha256: "e".repeat(64),
    restore_verified: true,
    candidate_deploy_verified: true,
    rollback_verified: true,
    roll_forward_verified: true,
    final_active_version: "0.1.0-ms-017",
    worker_scheduler_verified: true,
    public_ports_verified: true,
    production_touched: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false,
    external_registry_publish: false,
    git_tag_created: false,
    github_release_created: false
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
    image: { included: true, id: imageId }
  };
}
