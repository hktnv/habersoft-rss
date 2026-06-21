import { existsSync } from "node:fs";
import path from "node:path";
import { loadAndValidateTargetConfig, sanitizeTargetForReceipt } from "./staging/target-config.mjs";
import { assertNoInsecureSshArgs, buildScpArgs, buildSshArgs, posixSingleQuote } from "./staging/ssh-client.mjs";
import { loadReceipt, validateReceipt } from "./staging/receipt.mjs";

const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

try {
  switch (command) {
    case "preflight":
      preflight();
      break;
    case "deploy":
      guardedMutation("deploy", "confirm-environment", "staging");
      break;
    case "verify":
      guardedVerify();
      break;
    case "rollback":
      guardedMutation("rollback", "confirm-release", undefined);
      break;
    case "roll-forward":
      guardedMutation("roll-forward", "confirm-release", undefined);
      break;
    case "receipt:verify":
      receiptVerify();
      break;
    default:
      fail("usage: staging-deployment <preflight|deploy|verify|rollback|roll-forward|receipt:verify>");
  }
} catch (error) {
  fail(error.message);
}

function preflight() {
  const target = loadAndValidateTargetConfig(args.target);
  const markerCommand = [
    "set -eu",
    `test ! -L ${posixSingleQuote(target.remote_environment_marker_path)}`,
    `test "$(cat ${posixSingleQuote(target.remote_environment_marker_path)})" = ${posixSingleQuote(target.remote_environment_marker_value)}`,
    "hostname",
    "uname -a",
    "date -u +%Y-%m-%dT%H:%M:%SZ",
    "id",
    "docker version --format '{{.Server.Version}}'",
    "docker compose version",
    "df -Pk ."
  ].join(" && ");
  const sshArgs = buildSshArgs(target, markerCommand);
  assertNoInsecureSshArgs(sshArgs);
  console.log(JSON.stringify({
    status: "target-config-valid",
    target: sanitizeTargetForReceipt(target),
    read_only_preflight_required: true,
    ssh_options_verified: true,
    remote_mutation: false
  }, null, 2));
}

function guardedVerify() {
  const target = loadAndValidateTargetConfig(args.target);
  requireExistingFile(args["env-file"], "env-file");
  console.log(JSON.stringify({
    status: "verify-command-guarded",
    target: sanitizeTargetForReceipt(target),
    remote_mutation: false
  }, null, 2));
}

function guardedMutation(action, confirmName, confirmValue) {
  const target = loadAndValidateTargetConfig(args.target);
  requireExistingFile(args["env-file"], "env-file");
  requireExistingDirectory(args.package, "package");
  if (confirmValue !== undefined && args[confirmName] !== confirmValue) {
    throw new Error(`${confirmName} must be ${confirmValue}`);
  }
  if (confirmValue === undefined && (args[confirmName] === undefined || args[confirmName].trim() === "")) {
    throw new Error(`${confirmName} is required`);
  }
  const scpArgs = buildScpArgs(target, path.resolve(args.package), `${target.remote_base_dir}/incoming/`);
  assertNoInsecureSshArgs(scpArgs);
  throw new Error(`${action} is blocked in preparation mode until an approved target passes remote marker and host-key preflight`);
}

function receiptVerify() {
  const receipt = loadReceipt(args.receipt);
  validateReceipt(receipt);
  console.log("staging-receipt-verify: ok");
}

function requireExistingFile(file, name) {
  if (file === undefined || !existsSync(path.resolve(file))) {
    throw new Error(`${name} must exist`);
  }
}

function requireExistingDirectory(directory, name) {
  if (directory === undefined || !existsSync(path.resolve(directory))) {
    throw new Error(`${name} must exist`);
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
  console.error(`staging-deployment: ${message}`);
  process.exit(1);
}
