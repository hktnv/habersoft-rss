import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const envFile = args["env-file"];
const composeFile = args["compose-file"] ?? "deploy/production/compose.yaml";

if (envFile === undefined) {
  fail("production:compose:verify requires --env-file <path>");
}

run("node", ["scripts/production-config-check.mjs", "--env-file", envFile]);

const composeText = readFileSync(composeFile, "utf8");
assertNo(composeText.includes("tenant-auth-jwks-fixture"), "production Compose must not include local JWKS fixture");
assertNo(/\bbuild\s*:/u.test(composeText), "production Compose must not build from source");
assertNo(/5432:5432|6379:6379/u.test(composeText), "production Compose must not publish database or Redis ports");
assertYes(composeText.includes("127.0.0.1:${API_HOST_PORT"), "production API must bind to host loopback");

const quiet = spawnSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, "config", "--quiet"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (quiet.status !== 0) {
  process.exit(quiet.status ?? 1);
}

const json = spawnSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, "config", "--format", "json"], {
  encoding: "utf8",
  shell: process.platform === "win32"
});
if (json.status !== 0) {
  process.stderr.write(json.stderr);
  process.exit(json.status ?? 1);
}

const config = JSON.parse(json.stdout);
const services = Object.keys(config.services ?? {}).sort();
const expectedServices = ["main-service-api", "main-service-worker", "migrate", "postgres", "redis"];
assertYes(JSON.stringify(services) === JSON.stringify(expectedServices), `production service inventory mismatch: ${services.join(", ")}`);
assertYes(Object.keys(config.services["main-service-worker"].ports ?? {}).length === 0, "worker must not publish ports");
assertYes(Object.keys(config.services.postgres.ports ?? {}).length === 0, "postgres must not publish ports");
assertYes(Object.keys(config.services.redis.ports ?? {}).length === 0, "redis must not publish ports");
assertYes((config.services["main-service-api"].ports ?? []).some((port) => port.host_ip === "127.0.0.1"), "API must publish only on 127.0.0.1");

console.log("production-compose-verify: ok");

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    result[arg.slice(2)] = rawArgs[index + 1];
    index += 1;
  }
  return result;
}

function assertYes(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertNo(condition, message) {
  assertYes(!condition, message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
