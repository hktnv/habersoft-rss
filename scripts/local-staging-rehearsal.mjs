import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  assertExternalOutputRoot,
  assertSafeTeardownScope,
  buildRehearsalEnv,
  compareLocalRehearsalPackagePair,
  createProjectName,
  createRehearsalReceipt,
  directoryFileSha256,
  findFreeLoopbackPort,
  formatEnv,
  generateRehearsalSecrets,
  loadRehearsalReceipt,
  packageSha256,
  sha256File,
  SYNTHETIC_SENTINEL_STATUS,
  TENANT_AUTH_REHEARSAL_MODE,
  validateRehearsalReceipt
} from "./staging/local-rehearsal.mjs";
import { EXPECTED_MIGRATIONS, EXPECTED_SERVICES } from "./release-identity.mjs";

const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

try {
  switch (command) {
    case "run":
      await runLocalRehearsal();
      break;
    case "receipt:verify":
      receiptVerify();
      break;
    default:
      fail("usage: local-staging-rehearsal <run|receipt:verify>");
  }
} catch (error) {
  fail(error.message);
}

async function runLocalRehearsal() {
  const startedAt = new Date().toISOString();
  const previousCommit = requireCommit(args["previous-commit"], "previous-commit");
  const candidateCommit = requireCommit(args["candidate-commit"], "candidate-commit");
  if (previousCommit === candidateCommit) {
    throw new Error("previous and candidate commits must differ");
  }
  const platform = args.platform ?? "linux/amd64";
  if (!["linux/amd64", "linux/arm64"].includes(platform)) {
    throw new Error("platform must be linux/amd64 or linux/arm64");
  }

  const outputRoot = assertExternalOutputRoot(args["output-root"]);
  const masterDir = path.resolve(args["master-dir"] ?? path.join(process.cwd(), "..", ".md", "master"));
  mkdirSync(outputRoot, { recursive: true });
  const projectName = args.project ?? createProjectName(candidateCommit);
  assertSafeTeardownScope(projectName);

  const worktreeRoot = path.join(outputRoot, "worktrees");
  const previousWorktree = path.join(worktreeRoot, "previous", "main-service");
  const candidateWorktree = path.join(worktreeRoot, "candidate", "main-service");
  const packageRoot = path.join(outputRoot, "packages");
  const previousPackage = path.join(packageRoot, "previous-package");
  const candidatePackage = path.join(packageRoot, "candidate-package");
  const envDir = path.join(outputRoot, "env");
  const backupDir = path.join(outputRoot, "backup");
  const receiptDir = path.join(outputRoot, "receipt");
  const receiptFile = path.join(receiptDir, "local-staging-rehearsal-receipt.json");
  for (const directory of [path.dirname(previousWorktree), path.dirname(candidateWorktree), packageRoot, envDir, backupDir, receiptDir]) {
    mkdirSync(directory, { recursive: true });
  }

  let teardownVerified = false;
  let receipt;
  try {
    ensureGitObject(previousCommit);
    ensureGitObject(candidateCommit);
    createWorktree(previousWorktree, previousCommit);
    createWorktree(candidateWorktree, candidateCommit);

    const previousImageRef = `main-service-rehearsal-previous:${previousCommit.slice(0, 12)}`;
    const candidateImageRef = `main-service-rehearsal-candidate:${candidateCommit.slice(0, 12)}`;
    buildAndPackage("previous", previousWorktree, previousCommit, previousImageRef, previousPackage, platform, masterDir);
    buildAndPackage("candidate", candidateWorktree, candidateCommit, candidateImageRef, candidatePackage, platform, masterDir);

    const previousManifest = readJson(path.join(previousPackage, "manifest.json"));
    const candidateManifest = readJson(path.join(candidatePackage, "manifest.json"));
    const pair = compareLocalRehearsalPackagePair(previousManifest, candidateManifest, {
      previousSchemaSha256: gitBlobSha256(previousCommit, "prisma/schema.prisma"),
      candidateSchemaSha256: gitBlobSha256(candidateCommit, "prisma/schema.prisma"),
      previousComposeSha256: directoryFileSha256(previousPackage, "deploy/production/compose.yaml"),
      candidateComposeSha256: directoryFileSha256(candidatePackage, "deploy/production/compose.yaml")
    });

    loadImage(path.join(previousPackage, "main-service-image.tar"));
    loadImage(path.join(candidatePackage, "main-service-image.tar"));
    const previousImageId = inspectImageId(previousManifest.image.reference);
    const candidateImageId = inspectImageId(candidateManifest.image.reference);
    if (previousImageId !== previousManifest.image.id || candidateImageId !== candidateManifest.image.id) {
      throw new Error("loaded image id does not match package manifest");
    }

    const apiPort = await findFreeLoopbackPort();
    const secrets = generateRehearsalSecrets();
    const composeFile = path.join(candidatePackage, "deploy", "production", "compose.yaml");
    const candidateEnvFile = path.join(envDir, "candidate.env");
    const previousEnvFile = path.join(envDir, "previous.env");
    writePrivateFile(candidateEnvFile, formatEnv(buildRehearsalEnv({ imageId: candidateImageId, apiPort, projectName, secrets })));
    writePrivateFile(previousEnvFile, formatEnv(buildRehearsalEnv({ imageId: previousImageId, apiPort, projectName, secrets })));

    verifyComposeConfig(projectName, composeFile, candidateEnvFile);
    runComposeUp(projectName, composeFile, candidateEnvFile);
    verifyServiceImages(projectName, composeFile, candidateEnvFile, candidateImageId);
    await verifyApi(apiPort, "candidate-first");
    verifyWorker(projectName, composeFile, candidateEnvFile);
    verifyMigrationStatus(projectName, composeFile, candidateEnvFile);
    await writeAndVerifySentinel(apiPort, secrets.agentKey, projectName, composeFile, candidateEnvFile, 101);
    const backupPath = path.join(backupDir, "rehearsal-backup.dump");
    run("node", ["scripts/production-backup.mjs", "--compose-file", composeFile, "--env-file", candidateEnvFile, "--output", backupPath, "--project", projectName]);
    run("node", ["scripts/production-restore-verify.mjs", "--backup", backupPath]);

    switchApplicationImages(projectName, composeFile, previousEnvFile, previousImageId);
    await verifyApi(apiPort, "previous-rollback");
    verifyWorker(projectName, composeFile, previousEnvFile);
    verifyMigrationStatus(projectName, composeFile, previousEnvFile);
    verifySentinel(projectName, composeFile, previousEnvFile);
    await writeAndVerifySentinel(apiPort, secrets.agentKey, projectName, composeFile, previousEnvFile, 202);

    switchApplicationImages(projectName, composeFile, candidateEnvFile, candidateImageId);
    await verifyApi(apiPort, "candidate-roll-forward");
    verifyWorker(projectName, composeFile, candidateEnvFile);
    verifyMigrationStatus(projectName, composeFile, candidateEnvFile);
    verifySentinel(projectName, composeFile, candidateEnvFile);

    const finishedAt = new Date().toISOString();
    receipt = createRehearsalReceipt({
      previous_source_commit: previousCommit,
      candidate_source_commit: candidateCommit,
      previous_package_sha256: packageSha256(previousPackage),
      candidate_package_sha256: packageSha256(candidatePackage),
      previous_image_id: previousImageId,
      candidate_image_id: candidateImageId,
      migration_inventory: [...EXPECTED_MIGRATIONS],
      tenant_auth_rehearsal_mode: TENANT_AUTH_REHEARSAL_MODE,
      project_name: projectName,
      service_inventory: [...EXPECTED_SERVICES],
      package_pair_compatibility: pair,
      candidate_deploy_verified: true,
      api_ready_verified: true,
      worker_health_verified: true,
      sentinel_verified: true,
      backup_sha256: sha256File(backupPath),
      restore_verified: true,
      rollback_verified: true,
      roll_forward_verified: true,
      scheduler_verified: true,
      teardown_verified: false,
      started_at: startedAt,
      finished_at: finishedAt
    });
  } finally {
    teardownVerified = teardownProject(args.project ?? createProjectName(candidateCommit), path.join(outputRoot, "packages", "candidate-package", "deploy", "production", "compose.yaml"), path.join(outputRoot, "env", "candidate.env"));
    removeWorktree(previousWorktree);
    removeWorktree(candidateWorktree);
  }

  if (receipt === undefined) {
    throw new Error("rehearsal did not complete; no receipt was created");
  }
  receipt.teardown_verified = teardownVerified;
  receipt.finished_at = new Date().toISOString();
  validateRehearsalReceipt(receipt);
  writeJson(receiptFile, receipt);
  console.log(JSON.stringify({
    status: "local-staging-rehearsal-passed",
    project_name: receipt.project_name,
    previous_source_commit: receipt.previous_source_commit,
    candidate_source_commit: receipt.candidate_source_commit,
    previous_image_id: receipt.previous_image_id,
    candidate_image_id: receipt.candidate_image_id,
    tenant_auth_rehearsal_mode: receipt.tenant_auth_rehearsal_mode,
    remote_staging_contact_performed: false,
    production_deployment_performed: false,
    receipt_file: path.basename(receiptFile)
  }, null, 2));
}

function receiptVerify() {
  const receiptFile = args.receipt;
  if (receiptFile === undefined) {
    throw new Error("receipt is required");
  }
  const receipt = loadRehearsalReceipt(receiptFile);
  validateRehearsalReceipt(receipt);
  console.log("local-staging-rehearsal-receipt-verify: ok");
}

function buildAndPackage(role, worktree, commit, imageRef, packageDir, platform, masterDir) {
  prepareLegacyMasterLayout(worktree, masterDir);
  run("npm", ["ci"], { cwd: worktree });
  run("npm", ["run", "master:baseline:verify", "--", "--master-dir", masterDir], { cwd: worktree });
  run("npm", ["run", "release:verify"], { cwd: worktree, env: releaseGateEnv() });
  run("npm", ["run", "test:release-packaging"], { cwd: worktree, env: { ...releaseGateEnv(), MASTER_DIR: masterDir } });
  run("docker", ["build", "--platform", platform, "-t", imageRef, "."], { cwd: worktree });
  run("npm", ["run", "release:package", "--", "--platform", platform, "--output", packageDir, "--image", imageRef, "--master-dir", masterDir], { cwd: worktree });
  run("npm", ["run", "release:package:verify", "--", "--package", packageDir, "--source-commit", commit], { cwd: worktree });
  const manifest = readJson(path.join(packageDir, "manifest.json"));
  if (manifest.source_commit !== commit) {
    throw new Error(`${role} package source commit mismatch`);
  }
}

function prepareLegacyMasterLayout(worktree, masterDir) {
  const legacyMasterDir = path.join(path.dirname(worktree), ".md", "master");
  if (path.resolve(legacyMasterDir) === path.resolve(masterDir) || existsSync(legacyMasterDir)) {
    return;
  }
  mkdirSync(path.dirname(legacyMasterDir), { recursive: true });
  cpSync(masterDir, legacyMasterDir, { recursive: true });
}

function verifyComposeConfig(projectName, composeFile, envFile) {
  const config = dockerOutput(["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "config", "--format", "json"]);
  const parsed = JSON.parse(config);
  const services = Object.keys(parsed.services ?? {}).sort();
  if (JSON.stringify(services) !== JSON.stringify([...EXPECTED_SERVICES].sort())) {
    throw new Error(`service inventory mismatch: ${services.join(", ")}`);
  }
  for (const service of ["postgres", "redis", "main-service-worker"]) {
    if ((parsed.services[service].ports ?? []).length !== 0) {
      throw new Error(`${service} must not publish host ports`);
    }
  }
  const apiPorts = parsed.services["main-service-api"].ports ?? [];
  if (!apiPorts.some((port) => port.host_ip === "127.0.0.1")) {
    throw new Error("API must publish on loopback only");
  }
}

function runComposeUp(projectName, composeFile, envFile) {
  run("docker", ["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180"]);
}

function switchApplicationImages(projectName, composeFile, envFile, expectedImageId) {
  run("docker", ["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "up", "--no-build", "--pull", "never", "--force-recreate", "--no-deps", "migrate"]);
  run("docker", ["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "180", "main-service-api", "main-service-worker"]);
  verifyServiceImages(projectName, composeFile, envFile, expectedImageId);
}

function verifyServiceImages(projectName, composeFile, envFile, expectedImageId) {
  for (const service of ["main-service-api", "main-service-worker"]) {
    const container = dockerOutput(["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "ps", "-q", service]).trim();
    if (container === "") {
      throw new Error(`${service} container was not found`);
    }
    const imageId = dockerOutput(["inspect", "-f", "{{.Image}}", container]).trim();
    if (imageId !== expectedImageId) {
      throw new Error(`${service} image identity mismatch`);
    }
  }
}

async function verifyApi(apiPort, phase) {
  await waitForOk(`http://127.0.0.1:${apiPort}/health/live`, phase);
  await waitForOk(`http://127.0.0.1:${apiPort}/health/ready`, phase);
}

function verifyWorker(projectName, composeFile, envFile) {
  const output = dockerOutput(["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "exec", "-T", "main-service-worker", "npm", "run", "worker:health"]);
  if (!output.includes('"scheduler_id":"cleanup.daily"') || !output.includes('"global_concurrency":1')) {
    throw new Error("worker health did not prove scheduler inventory");
  }
}

function verifyMigrationStatus(projectName, composeFile, envFile) {
  const output = dockerOutput(["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "exec", "-T", "main-service-api", "npm", "run", "migrate:status"]);
  if (!/Database schema is up to date|already in sync|No pending migrations/iu.test(output)) {
    throw new Error("migration status did not prove no-op state");
  }
  const migrations = parsePsqlCount(
    psql(projectName, composeFile, envFile, "select count(*) from _prisma_migrations where migration_name in ('20260620000000_initial_empty','20260620001000_canonical_business_schema');"),
    "migration inventory"
  );
  if (migrations !== EXPECTED_MIGRATIONS.length) {
    throw new Error("migration inventory count mismatch");
  }
}

async function writeAndVerifySentinel(apiPort, agentKey, projectName, composeFile, envFile, feedsProcessed) {
  const response = await fetch(`http://127.0.0.1:${apiPort}/agent/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Agent-Key": agentKey
    },
    body: JSON.stringify({
      status: SYNTHETIC_SENTINEL_STATUS,
      sent_at: new Date().toISOString(),
      feeds_processed: feedsProcessed,
      errors_count: 0,
      stale_check_results_dropped: 0,
      stale_entries_dropped: 0
    })
  });
  if (!response.ok) {
    throw new Error(`sentinel heartbeat failed with ${response.status}`);
  }
  const body = await response.json();
  if (body.ok !== true) {
    throw new Error("sentinel heartbeat response mismatch");
  }
  verifySentinel(projectName, composeFile, envFile);
}

function verifySentinel(projectName, composeFile, envFile) {
  const count = parsePsqlCount(psql(projectName, composeFile, envFile, "select count(*) from agent_runtime_status where agent_id='default' and status='ok';"), "sentinel");
  if (count !== 1) {
    throw new Error("sentinel row was not preserved");
  }
}

function psql(projectName, composeFile, envFile, sql) {
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const result = spawnSync("docker", ["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "exec", "-T", "postgres", "psql", "-X", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB, "-At", "-v", "ON_ERROR_STOP=1"], {
    input: `${sql}\n`,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "psql query failed");
  }
  return result.stdout;
}

function parsePsqlCount(output, label) {
  const numericLines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/u.test(line));
  if (numericLines.length === 0) {
    throw new Error(`${label} count was not numeric`);
  }
  return Number(numericLines.at(-1));
}

function teardownProject(projectName, composeFile, envFile) {
  assertSafeTeardownScope(projectName);
  if (existsSync(composeFile) && existsSync(envFile)) {
    run("docker", ["compose", "-p", projectName, "--env-file", envFile, "-f", composeFile, "down", "-v", "--remove-orphans", "--timeout", "20"], { allowFailure: true });
  }
  const containers = dockerOutput(["ps", "-a", "--filter", `label=com.docker.compose.project=${projectName}`, "-q"]).trim();
  const volumes = dockerOutput(["volume", "ls", "--filter", `label=com.docker.compose.project=${projectName}`, "-q"]).trim();
  const networks = dockerOutput(["network", "ls", "--filter", `label=com.docker.compose.project=${projectName}`, "-q"]).trim();
  if (containers !== "" || volumes !== "" || networks !== "") {
    throw new Error("teardown left project resources behind");
  }
  return true;
}

async function waitForOk(url, phase) {
  let lastStatus = "none";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      lastStatus = String(response.status);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastStatus = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${phase} API check failed: ${lastStatus}`);
}

function createWorktree(directory, commit) {
  if (existsSync(directory)) {
    throw new Error(`worktree target already exists: ${path.basename(directory)}`);
  }
  run("git", ["worktree", "add", "--detach", directory, commit]);
}

function removeWorktree(directory) {
  if (existsSync(directory)) {
    run("git", ["worktree", "remove", "--force", directory], { allowFailure: true });
  }
}

function ensureGitObject(commit) {
  run("git", ["rev-parse", "--verify", commit]);
}

function gitBlobSha256(commit, file) {
  const content = gitOutput(["show", `${commit}:${file}`]);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function gitOutput(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

function loadImage(imageTar) {
  run("docker", ["load", "--input", imageTar]);
}

function inspectImageId(imageRef) {
  const output = dockerOutput(["image", "inspect", "--format", "{{.Id}}", imageRef]).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(output)) {
    throw new Error("image inspect did not return a sha256 image id");
  }
  return output;
}

function dockerOutput(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `docker ${args[0]} failed`);
  }
  return result.stdout;
}

function run(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.encoding === "utf8" ? undefined : "inherit",
    encoding: options.encoding,
    shell: process.platform === "win32"
  });
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(`${commandName} ${commandArgs[0] ?? ""} failed`);
  }
  return result;
}

function releaseGateEnv() {
  return {
    ...process.env,
    DATABASE_URL: "postgresql://main_service:local_rehearsal_dummy_password@postgres:5432/main_service?schema=public"
  };
}

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writePrivateFile(file, text) {
  writeFileSync(file, text, { mode: 0o600 });
  if (process.platform !== "win32") {
    chmodSync(file, 0o600);
  }
}

function requireCommit(value, name) {
  if (!/^[a-f0-9]{40}$/u.test(String(value ?? ""))) {
    throw new Error(`${name} must be a full lowercase git commit`);
  }
  return value;
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
  console.error(`local-staging-rehearsal: ${message}`);
  process.exit(1);
}
