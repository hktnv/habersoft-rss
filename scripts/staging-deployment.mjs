import { existsSync } from "node:fs";
import path from "node:path";
import { loadAndValidateTargetConfig, sanitizeTargetForReceipt } from "./staging/target-config.mjs";
import { assertNoInsecureSshArgs, buildScpArgs } from "./staging/ssh-client.mjs";
import { loadReceipt, validateReceipt } from "./staging/receipt.mjs";
import {
  validatePreflightComparison,
  validatePreflightReceipt,
  runRemotePreflight,
  writePreflightComparison
} from "./staging/remote-preflight.mjs";

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
    case "receipt:compare":
      receiptCompare();
      break;
    default:
      fail("usage: staging-deployment <preflight|deploy|verify|rollback|roll-forward|receipt:verify|receipt:compare>");
  }
} catch (error) {
  fail(error.message);
}

function preflight() {
  const { receipt, receiptFile } = runRemotePreflight(args);
  console.log(JSON.stringify({
    status: "remote-staging-readonly-preflight-passed",
    target_alias: receipt.target_alias,
    environment_marker_verified: receipt.environment_marker_verified,
    remote_architecture: receipt.remote_architecture,
    docker_available: receipt.docker_available,
    compose_v2_available: receipt.compose_v2_available,
    project_state: receipt.project_state,
    api_port_state: receipt.api_port_state,
    base_dir_state: receipt.base_dir_state,
    filesystem_state: receipt.filesystem_state,
    edge_mode: receipt.edge_mode,
    inventory_unchanged: receipt.inventory_unchanged,
    remote_mutation: false,
    receipt_file: path.basename(receiptFile)
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
  if (receipt.receipt_type === "remote-staging-readonly-preflight") {
    validatePreflightReceipt(receipt);
    console.log("staging-preflight-receipt-verify: ok");
    return;
  }
  if (receipt.receipt_type === "remote-staging-readonly-preflight-comparison") {
    validatePreflightComparison(receipt);
    console.log("staging-preflight-comparison-verify: ok");
    return;
  }
  validateReceipt(receipt);
  console.log("staging-receipt-verify: ok");
}

function receiptCompare() {
  const { output } = writePreflightComparison(args);
  console.log(JSON.stringify({
    status: "staging-preflight-comparison-verified",
    comparison_file: path.basename(output)
  }, null, 2));
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
