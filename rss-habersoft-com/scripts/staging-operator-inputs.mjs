import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { loadAndValidateTargetConfig, sanitizeTargetForReceipt, validateTargetConfig } from "./staging/target-config.mjs";
import {
  assertEnvFileMode,
  formatEnv,
  loadEnvFile,
  stagingEnvFromTemplate,
  validateStagingEnv
} from "./staging/env-inputs.mjs";
import { inspectKnownHostsForTarget } from "./staging/known-hosts.mjs";
import {
  createReadinessReceipt,
  loadReadinessReceipt,
  validateReadinessReceipt
} from "./staging/operator-receipt.mjs";

const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);
const repoRoot = process.cwd();

try {
  switch (command) {
    case "scaffold":
      scaffold();
      break;
    case "verify":
      verify();
      break;
    case "known-hosts:inspect":
      inspectKnownHosts();
      break;
    case "receipt:verify":
      receiptVerify();
      break;
    default:
      fail("usage: staging-operator-inputs <scaffold|verify|known-hosts:inspect|receipt:verify>; verify supports --idp-contract <path>");
  }
} catch (error) {
  fail(error.message);
}

function scaffold() {
  const outputDir = requiredExternalPath(args["output-dir"], "output-dir");
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0 && args.overwrite !== "true") {
    throw new Error("output-dir must be empty unless --overwrite true is supplied");
  }
  mkdirSync(outputDir, { recursive: true });

  const target = scaffoldTarget();
  const targetFile = path.join(outputDir, "staging-target.json");
  const envFile = path.join(outputDir, "staging.env");
  const receiptFile = path.join(outputDir, "staging-input-readiness.json");
  assertExternalPath(path.resolve(target.known_hosts_file), "known_hosts-file");
  validateTargetConfig(target, { requireApproved: false, requireKnownHostsReadable: false });
  for (const file of [targetFile, envFile, receiptFile]) {
    if (existsSync(file) && args.overwrite !== "true") {
      throw new Error(`${path.basename(file)} already exists`);
    }
  }
  if (args["generate-staging-secrets"] === "true" && existsSync(envFile)) {
    throw new Error("secret generation refuses to overwrite an existing staging.env");
  }

  const env = stagingEnvFromTemplate(target, args["generate-staging-secrets"] === "true" ? generateStagingSecrets() : {});
  writeJson(targetFile, target, 0o600);
  writeText(envFile, formatEnv(env), 0o600);
  const receipt = createReadinessReceipt(target, {
    targetSchemaValid: false,
    envSchemaValid: false,
    secretsPresent: args["generate-staging-secrets"] === "true",
    knownHostsFilePresent: existsSync(path.resolve(target.known_hosts_file)),
    knownHostsEntryPresent: false,
    remoteEnvironmentMarkerConfigured: isMarkerConfigured(target),
    imageIdentityReady: false
  });
  writeJson(receiptFile, receipt, 0o644);

  console.log(JSON.stringify({
    status: "staging-operator-inputs-scaffolded",
    target: sanitizeTargetForReceipt(target),
    approved_default: false,
    output_files: ["staging-target.json", "staging.env", "staging-input-readiness.json"],
    known_hosts_created: false,
    ssh_contacted: false,
    remote_contacted: false,
    secret_values_printed: false
  }, null, 2));
}

function verify() {
  const mode = args.mode ?? "operator-input";
  if (!["operator-input", "deployment-ready"].includes(mode)) {
    throw new Error("mode must be operator-input or deployment-ready");
  }
  const targetFile = requiredExternalPath(args.target, "target");
  const envFile = requiredExternalPath(args["env-file"], "env-file");
  assertNotTracked(targetFile, "target");
  assertNotTracked(envFile, "env-file");

  const target = loadAndValidateTargetConfig(targetFile);
  assertExternalPath(path.resolve(target.known_hosts_file), "known_hosts_file");
  assertNotTracked(path.resolve(target.known_hosts_file), "known_hosts_file");
  const env = loadEnvFile(envFile);
  const envModeResult = validateStagingEnv(env, target, mode, { idpContractFile: args["idp-contract"] });
  assertEnvFileMode(envFile);
  const knownHosts = inspectKnownHostsForTarget(target);
  let imageIdentityReady = envModeResult.imageIdentityReady;
  if (mode === "deployment-ready") {
    if (args["runtime-image-env"] === undefined) {
      throw new Error("deployment-ready mode requires --runtime-image-env from a verified package");
    }
    const runtimeImageEnv = requiredExternalPath(args["runtime-image-env"], "runtime-image-env");
    run("node", ["scripts/production-config-check.mjs", "--env-file", envFile, "--runtime-image-env", runtimeImageEnv]);
    run("node", ["scripts/production-compose-verify.mjs", "--env-file", envFile, "--runtime-image-env", runtimeImageEnv]);
    imageIdentityReady = true;
  }

  const receipt = createReadinessReceipt(target, {
    targetSchemaValid: true,
    envSchemaValid: envModeResult.envSchemaValid,
    secretsPresent: envModeResult.secretsPresent,
    knownHostsFilePresent: true,
    knownHostsEntryPresent: knownHosts.entry_found === true,
    remoteEnvironmentMarkerConfigured: isMarkerConfigured(target),
    imageIdentityReady,
    idpContract: envModeResult.idpContract
  });
  validateReadinessReceipt(receipt);
  const receiptFile = args.receipt === undefined
    ? path.join(path.dirname(targetFile), "staging-input-readiness.json")
    : requiredExternalPath(args.receipt, "receipt");
  writeJson(receiptFile, receipt, 0o644);

  console.log(JSON.stringify({
    status: "staging-operator-inputs-verified",
    mode,
    target: sanitizeTargetForReceipt(target),
    known_hosts_entry_present: true,
    image_identity_ready: imageIdentityReady,
    legacy_image_field_present: envModeResult.legacyImageFieldPresent,
    package_image_required: envModeResult.packageImageRequired,
    idp_contract_present: envModeResult.idpContract.contract_present,
    idp_contract_verified: envModeResult.idpContract.contract_verified,
    idp_contract_decision: envModeResult.idpContract.decision,
    idp_contract_owner: envModeResult.idpContract.owner,
    idp_contract_raw_sha256: envModeResult.idpContract.raw_sha256,
    idp_contract_lf_normalized_sha256: envModeResult.idpContract.lf_normalized_sha256,
    ready_for_read_only_remote_preflight: receipt.ready_for_read_only_remote_preflight,
    host_key_trust_confirmed_by_tool: false,
    remote_environment_marker_verified: false,
    ssh_contacted: false,
    remote_contacted: false,
    remote_mutation: false,
    receipt_file: path.basename(receiptFile)
  }, null, 2));
}

function inspectKnownHosts() {
  const targetFile = requiredExternalPath(args.target, "target");
  assertNotTracked(targetFile, "target");
  const target = loadAndValidateTargetConfig(targetFile);
  assertExternalPath(path.resolve(target.known_hosts_file), "known_hosts_file");
  assertNotTracked(path.resolve(target.known_hosts_file), "known_hosts_file");
  const inspection = inspectKnownHostsForTarget(target);
  console.log(JSON.stringify(inspection, null, 2));
  console.error("Compare this fingerprint with the host owner through an out-of-band trusted channel before approving remote preflight.");
}

function receiptVerify() {
  const receipt = loadReadinessReceipt(args.receipt);
  validateReadinessReceipt(receipt);
  console.log("staging-input-readiness-verify: ok");
}

function scaffoldTarget() {
  const sshPort = Number(args["ssh-port"]);
  const apiPort = Number(args["api-port"]);
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error("ssh-port must be an integer between 1 and 65535");
  }
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
    throw new Error("api-port must be an integer between 1024 and 65535");
  }
  const edgeMode = requiredString(args["edge-mode"], "edge-mode");
  if (!["loopback-only", "https"].includes(edgeMode)) {
    throw new Error("edge-mode must be loopback-only or https");
  }
  if (edgeMode === "https" && args["public-base-url"] === undefined) {
    throw new Error("public-base-url is required for https edge mode");
  }
  return {
    environment: "staging",
    approved: false,
    target_alias: requiredString(args["target-alias"], "target-alias"),
    ssh_host: requiredString(args["ssh-host"], "ssh-host"),
    ssh_port: sshPort,
    ssh_user: requiredString(args["ssh-user"], "ssh-user"),
    known_hosts_file: path.resolve(requiredString(args["known-hosts-file"], "known-hosts-file")),
    remote_environment_marker_path: requiredString(args["marker-path"], "marker-path"),
    remote_environment_marker_value: "staging",
    remote_base_dir: requiredString(args["remote-base-dir"], "remote-base-dir"),
    compose_project_name: requiredString(args["project-name"], "project-name"),
    api_host_port: apiPort,
    edge_mode: edgeMode,
    public_base_url: edgeMode === "https" ? args["public-base-url"] : null
  };
}

function generateStagingSecrets() {
  return {
    postgresPassword: randomSecret(32),
    rateLimitSecret: randomSecret(48),
    agentKey: randomSecret(48)
  };
}

function randomSecret(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function requiredExternalPath(value, name) {
  const resolved = path.resolve(requiredString(value, name));
  assertExternalPath(resolved, name);
  return resolved;
}

function assertExternalPath(resolved, name) {
  if (isInsideRepo(resolved)) {
    throw new Error(`${name} must be outside the repository`);
  }
}

function assertNotTracked(file, name) {
  if (!isInsideRepo(file)) {
    return;
  }
  const relative = path.relative(repoRoot, file);
  const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status === 0) {
    throw new Error(`${name} must not be tracked by Git`);
  }
}

function isInsideRepo(file) {
  const relative = path.relative(repoRoot, path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isMarkerConfigured(target) {
  return target.remote_environment_marker_path === "/etc/habersoft/environment" && target.remote_environment_marker_value === "staging";
}

function run(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function writeJson(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  setMode(file, mode);
}

function writeText(file, value, mode) {
  writeFileSync(file, value, { mode });
  setMode(file, mode);
}

function setMode(file, mode) {
  if (process.platform !== "win32") {
    chmodSync(file, mode);
  }
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const next = rawArgs[index + 1];
    result[arg.slice(2)] = next?.startsWith("--") || next === undefined ? "true" : next;
    if (result[arg.slice(2)] !== "true") {
      index += 1;
    }
  }
  return result;
}

function fail(message) {
  console.error(`staging-operator-inputs: ${message}`);
  process.exit(1);
}
