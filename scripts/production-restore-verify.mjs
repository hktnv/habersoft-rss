import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { EXPECTED_MIGRATIONS, RELEASE_IDENTITY } from "./release-identity.mjs";

const CONTRACT_VERSION = "production-backup-restore-evidence-v1";
const PARENT_OPERATIONAL_RECEIPT_SHA256 = "3a5624a5cab3044a1797d9c8ee78e92828a28233a67f759b8bf6845a7ecc4620";
const POSTGRES_IMAGE = "postgres:17.9-bookworm";
const DUMP_FILENAME = "main-service-production.dump";
const METADATA_FILENAME = "backup-capture-metadata.json";
const CAPTURE_RECEIPT_FILENAME = "backup-capture-receipt.json";
const CHECKSUMS_FILENAME = "checksums.sha256";
const TOOL_NAME = "production-restore-verify";
const DOCKER_BIN = process.env.MS019C_DOCKER_BIN ?? "docker";
const DOCKER_FAKE_SCRIPT = process.env.MS019C_DOCKER_FAKE_SCRIPT;
const KNOWN_FLAGS = new Set(["input-dir", "backup", "receipt"]);
const CANONICAL_TABLES = Object.freeze([
  "feeds",
  "entries",
  "entry_details",
  "site_feeds",
  "agent_feed_check_events",
  "agent_runtime_status"
]);

try {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "contract:describe") {
    describeContract();
    process.exit(0);
  }
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printUsage();
    process.exit(0);
  }
  const args = parseArgs(rawArgs);
  assertKnownFlags(args);
  assert(!(args["input-dir"] !== undefined && args.backup !== undefined), "input-dir and backup modes cannot be combined");
  verifyRestore(args);
} catch (error) {
  fail(error.message);
}

function describeContract() {
  console.log(JSON.stringify({
    schema_version: 1,
    tool_name: TOOL_NAME,
    contract_version: CONTRACT_VERSION,
    accepted_input_mode: "capture-bundle-and-legacy-backup-file",
    capture_bundle_mode: {
      required_flags: ["--input-dir"],
      optional_flags: ["--receipt"],
      input_files: [DUMP_FILENAME, METADATA_FILENAME, CAPTURE_RECEIPT_FILENAME, CHECKSUMS_FILENAME],
      output_mode: "external-restore-receipt-json"
    },
    legacy_file_mode: {
      required_flags: ["--backup"],
      optional_flags: ["--receipt"],
      output_mode: "console-status-or-external-restore-receipt-json"
    },
    backup_format: "POSTGRESQL_CUSTOM",
    docker_context_allowed_classes: ["LOCAL_UNIX_SOCKET", "LOCAL_WINDOWS_NPIPE"],
    postgres_image: POSTGRES_IMAGE,
    production_contact_performed_by_contract_probe: false,
    production_mutation_performed: false,
    production_restore_performed: false,
    secrets_included: false
  }, null, 2));
}

function printUsage() {
  console.log([
    "usage:",
    "  production-restore-verify contract:describe",
    "  production-restore-verify --input-dir <flat-capture-bundle-dir> [--receipt <external-receipt.json>]",
    "  production-restore-verify --backup <backup.dump> [--receipt <external-receipt.json>]"
  ].join("\n"));
}

function verifyRestore(options) {
  const input = loadInput(options);
  const context = inspectDockerContext();
  const postgresImageId = inspectPostgresImage();
  const nonce = randomBytes(6).toString("hex");
  const resources = {
    network: `main-service-ms019c-restore-net-${nonce}`,
    volume: `main-service-ms019c-restore-vol-${nonce}`,
    container: `main-service-ms019c-restore-pg-${nonce}`
  };
  const password = randomBytes(24).toString("base64url");
  let restorePassed = false;
  let tablesPassed = false;
  let migrationsPassed = false;
  let failedMigrationCount = "NOT_RECORDED";
  let teardownVerified = false;

  try {
    run(DOCKER_BIN, ["network", "create", resources.network]);
    run(DOCKER_BIN, ["volume", "create", resources.volume]);
    run(DOCKER_BIN, [
      "run",
      "-d",
      "--name",
      resources.container,
      "--network",
      resources.network,
      "-v",
      `${resources.volume}:/var/lib/postgresql/data`,
      "-e",
      "POSTGRES_USER=restore_verify",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=restore_verify",
      POSTGRES_IMAGE
    ]);
    waitForPostgres(resources.container, password);
    run(DOCKER_BIN, ["cp", input.dumpPath, `${resources.container}:/tmp/backup.dump`]);
    run(DOCKER_BIN, [
      "exec",
      "-e",
      `PGPASSWORD=${password}`,
      resources.container,
      "pg_restore",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "-h",
      "127.0.0.1",
      "-U",
      "restore_verify",
      "-d",
      "restore_verify",
      "/tmp/backup.dump"
    ]);
    restorePassed = true;
    const tableCount = Number(psql(resources.container, password, `select count(*) from information_schema.tables where table_schema='public' and table_name in (${CANONICAL_TABLES.map((table) => `'${table}'`).join(",")});`));
    tablesPassed = tableCount === CANONICAL_TABLES.length;
    if (!tablesPassed) {
      throw new Error(`canonical table verification failed: ${tableCount}`);
    }
    const migrationCount = Number(psql(resources.container, password, `select count(*) from _prisma_migrations where migration_name in (${EXPECTED_MIGRATIONS.map((migration) => `'${migration}'`).join(",")}) and finished_at is not null and rolled_back_at is null;`));
    failedMigrationCount = psql(resources.container, password, "select count(*) from _prisma_migrations where rolled_back_at is not null;");
    migrationsPassed = migrationCount === EXPECTED_MIGRATIONS.length && failedMigrationCount === "0";
    if (!migrationsPassed) {
      throw new Error(`migration verification failed: expected=${migrationCount} failed=${failedMigrationCount}`);
    }
  } finally {
    teardownVerified = teardown(resources);
  }
  if (!teardownVerified) {
    throw new Error("teardown verification failed");
  }

  const receipt = {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    receipt_type: "off-host-disposable-restore",
    milestone: "MS-019C",
    service: RELEASE_IDENTITY.application,
    source_environment: "production-backup",
    restore_environment: "off-host-disposable",
    restored_at_utc: new Date().toISOString(),
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    backup_sha256: input.backupSha256,
    backup_bytes: input.backupBytes,
    capture_receipt_sha256: input.captureReceiptSha256,
    docker_context: {
      class: context.class,
      local_engine: true
    },
    postgres: {
      image: POSTGRES_IMAGE,
      image_id: postgresImageId
    },
    restore_command_result: restorePassed ? "PASSED" : "FAILED",
    canonical_tables: Object.fromEntries(CANONICAL_TABLES.map((table) => [table, tablesPassed ? "PASSED" : "FAILED"])),
    expected_migrations: [...EXPECTED_MIGRATIONS],
    migration_verification: migrationsPassed ? "PASSED" : "FAILED",
    failed_migration_count: failedMigrationCount,
    teardown: {
      result: teardownVerified ? "PASSED" : "FAILED",
      disposable_resources_removed: teardownVerified
    },
    production_contact_performed: false,
    production_mutation_performed: false,
    production_restore_performed: false,
    secrets_included: false
  };
  assertSafeReceipt(receipt, "restore receipt");
  if (options.receipt !== undefined) {
    const receiptPath = path.resolve(options.receipt);
    assert(!existsSync(receiptPath), "restore receipt output must not already exist");
    mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
    writeJson(receiptPath, receipt, 0o600);
  }
  console.log(JSON.stringify({
    status: "production-restore-verify-ok",
    backup_sha256: input.backupSha256,
    restore_command_result: receipt.restore_command_result,
    migration_verification: receipt.migration_verification,
    teardown_result: receipt.teardown.result,
    production_contact_performed: false,
    production_mutation_performed: false
  }, null, 2));
}

function loadInput(options) {
  if (options["input-dir"] !== undefined) {
    return loadCaptureBundle(path.resolve(options["input-dir"]));
  }
  const backupPath = path.resolve(requiredValue(options.backup, "backup"));
  assert(existsSync(backupPath), "backup does not exist");
  assertCustomDump(backupPath);
  const backupBytes = readFileSync(backupPath);
  const metadataPath = `${backupPath}.metadata.json`;
  if (existsSync(metadataPath)) {
    const metadata = readJson(metadataPath);
    if (metadata.sha256 !== undefined) {
      assert(metadata.sha256 === sha256(backupBytes), "backup checksum mismatch");
    }
  }
  return {
    dumpPath: backupPath,
    backupSha256: sha256(backupBytes),
    backupBytes: backupBytes.length,
    captureReceiptSha256: "NOT_RECORDED"
  };
}

function loadCaptureBundle(directory) {
  assert(existsSync(directory) && statSync(directory).isDirectory(), "input-dir must exist");
  assertExactFiles(directory, [DUMP_FILENAME, METADATA_FILENAME, CAPTURE_RECEIPT_FILENAME, CHECKSUMS_FILENAME]);
  verifyChecksums(directory, [DUMP_FILENAME, METADATA_FILENAME, CAPTURE_RECEIPT_FILENAME]);
  const dumpPath = path.join(directory, DUMP_FILENAME);
  assertCustomDump(dumpPath);
  const dumpBytes = readFileSync(dumpPath);
  const metadata = readJson(path.join(directory, METADATA_FILENAME));
  const captureReceipt = readJson(path.join(directory, CAPTURE_RECEIPT_FILENAME));
  assert(metadata.contract_version === CONTRACT_VERSION, "metadata contract mismatch");
  assert(captureReceipt.contract_version === CONTRACT_VERSION, "capture receipt contract mismatch");
  assert(captureReceipt.receipt_type === "production-backup-capture", "capture receipt type mismatch");
  assert(metadata.backup_sha256 === sha256(dumpBytes), "metadata backup SHA mismatch");
  assert(captureReceipt.backup?.sha256 === sha256(dumpBytes), "capture receipt backup SHA mismatch");
  assert(metadata.backup_bytes === dumpBytes.length, "metadata backup size mismatch");
  assert(captureReceipt.backup?.bytes === dumpBytes.length, "capture receipt backup size mismatch");
  assert(captureReceipt.parent_ms019b_operational_receipt_sha256 === PARENT_OPERATIONAL_RECEIPT_SHA256, "parent MS-019B receipt mismatch");
  assert(captureReceipt.production_mutation_performed === false, "capture receipt mutation flag must be false");
  assert(captureReceipt.restore_performed === false, "capture receipt restore flag must be false");
  scanValueForSecrets(metadata, "metadata");
  scanValueForSecrets(captureReceipt, "capture receipt");
  return {
    dumpPath,
    backupSha256: sha256(dumpBytes),
    backupBytes: dumpBytes.length,
    captureReceiptSha256: sha256(readFileSync(path.join(directory, CAPTURE_RECEIPT_FILENAME)))
  };
}

function inspectDockerContext() {
  const result = spawnDocker(["context", "inspect"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error("docker context inspect failed");
  }
  const parsed = JSON.parse(result.stdout);
  const context = parsed[0] ?? {};
  const name = String(context.Name ?? "");
  const host = String(context.Endpoints?.docker?.Host ?? "");
  assert(!/prod|production/iu.test(name), "production Docker context name rejected");
  if (host.startsWith("unix://")) {
    return { class: "LOCAL_UNIX_SOCKET" };
  }
  if (host.startsWith("npipe:////./pipe/docker_engine") || host.startsWith("npipe://")) {
    return { class: "LOCAL_WINDOWS_NPIPE" };
  }
  if (host.startsWith("ssh://") || host.startsWith("tcp://")) {
    throw new Error("remote Docker context rejected");
  }
  throw new Error("unknown Docker context endpoint rejected");
}

function inspectPostgresImage() {
  const result = spawnDocker(["image", "inspect", POSTGRES_IMAGE, "--format", "{{.Id}}"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error("OPERATOR_ACTION_REQUIRED_IMAGE_UNAVAILABLE");
  }
  const imageId = result.stdout.trim();
  assert(/^sha256:[a-f0-9]{64}$/u.test(imageId), "PostgreSQL image inspect did not return a sha256 image id");
  return imageId;
}

function waitForPostgres(containerName, password) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnDocker([
      "exec",
      "-e",
      `PGPASSWORD=${password}`,
      containerName,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "restore_verify",
      "-d",
      "restore_verify",
      "-Atc",
      "select 1;"
    ], { stdio: "ignore", shell: process.platform === "win32" });
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("restore PostgreSQL did not become ready");
}

function psql(containerName, password, sql) {
  const result = spawnDocker([
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    containerName,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "restore_verify",
    "-d",
    "restore_verify",
    "-Atc",
    sql
  ], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error("psql verification failed");
  }
  const output = result.stdout.trim();
  assert(/^\d+$/u.test(output), "psql verification returned non-numeric output");
  return output;
}

function teardown(resources) {
  spawnDocker(["rm", "-f", resources.container], { stdio: "ignore", shell: process.platform === "win32" });
  spawnDocker(["volume", "rm", "-f", resources.volume], { stdio: "ignore", shell: process.platform === "win32" });
  spawnDocker(["network", "rm", resources.network], { stdio: "ignore", shell: process.platform === "win32" });
  return [
    ["container", "inspect", resources.container],
    ["volume", "inspect", resources.volume],
    ["network", "inspect", resources.network]
  ].every((dockerArgs) => spawnDocker(dockerArgs, { stdio: "ignore", shell: process.platform === "win32" }).status !== 0);
}

function assertExactFiles(directory, expected) {
  const seen = readdirSync(directory, { withFileTypes: true });
  const names = seen.map((entry) => entry.name).sort();
  assert(JSON.stringify(names) === JSON.stringify([...expected].sort()), `unexpected input inventory: ${names.join(",")}`);
  for (const entry of seen) {
    const fullPath = path.join(directory, entry.name);
    const stat = lstatSync(fullPath);
    assert(stat.isFile(), `input contains non-file: ${entry.name}`);
    assert(!entry.name.endsWith(".zip") && !entry.name.endsWith(".tar"), "archive must not be in input directory");
  }
}

function verifyChecksums(directory, files) {
  const lines = readFileSync(path.join(directory, CHECKSUMS_FILENAME), "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line !== "");
  const map = new Map(lines.map((line) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u.exec(line);
    assert(match !== null, "checksum line malformed");
    return [match[2], match[1]];
  }));
  for (const file of files) {
    assert(map.get(file) === sha256(readFileSync(path.join(directory, file))), `checksum mismatch for ${file}`);
  }
  assert(map.size === files.length, "checksum file must cover exact payload files");
}

function assertCustomDump(file) {
  const bytes = readFileSync(file);
  assert(bytes.length >= 5, "backup dump is too small");
  assert(bytes.subarray(0, 5).toString("ascii") === "PGDMP", "backup is not a PostgreSQL custom-format dump");
}

function assertSafeReceipt(value, label) {
  scanValueForSecrets(value, label);
}

function scanValueForSecrets(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    /DATABASE_URL/iu,
    /POSTGRES_PASSWORD/iu,
    /TENANT_RATE_LIMIT_KEY_SECRET/iu,
    /AGENT_KEY/iu,
    /PGPASSWORD/iu,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /Bearer\s+[A-Za-z0-9._-]+/u,
    /[A-Za-z]:\\/u,
    /\/home\//u,
    /\/Users\//u,
    /feed_url|title|content|tenant_id|raw_sql|dump_bytes/iu
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `${label} contains forbidden sensitive content`);
  }
}

function run(command, commandArgs) {
  const result = command === DOCKER_BIN
    ? spawnDocker(commandArgs, { stdio: "ignore", shell: process.platform === "win32" })
    : spawnSync(command, commandArgs, { stdio: "ignore", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs[0] ?? ""} failed`);
  }
}

function spawnDocker(commandArgs, options) {
  if (DOCKER_FAKE_SCRIPT !== undefined && DOCKER_FAKE_SCRIPT !== "") {
    return spawnSync(process.execPath, [DOCKER_FAKE_SCRIPT, ...commandArgs], {
      ...options,
      shell: false
    });
  }
  return spawnSync(DOCKER_BIN, commandArgs, options);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function requiredValue(value, label) {
  assert(value !== undefined && value !== "", `${label} is required`);
  return value;
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unknown positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === "") {
      throw new Error("empty flag is not supported");
    }
    const next = rawArgs[index + 1];
    result[key] = next === undefined || next.startsWith("--") ? "true" : next;
    if (result[key] !== "true") {
      index += 1;
    }
  }
  return result;
}

function assertKnownFlags(options) {
  for (const key of Object.keys(options)) {
    assert(KNOWN_FLAGS.has(key), `unsupported flag: --${key}`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error(`production-restore-verify: ${message}`);
  process.exit(1);
}
