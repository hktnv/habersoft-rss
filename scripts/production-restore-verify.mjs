import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const backup = args.backup;

if (backup === undefined) {
  fail("production:restore:verify requires --backup <backup.dump>");
}

const backupPath = path.resolve(backup);
const metadataPath = `${backupPath}.metadata.json`;
const backupBytes = readFileSync(backupPath);
let metadata;
if (existsSync(metadataPath)) {
  metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.sha256 !== sha256(backupBytes)) {
    fail("backup checksum mismatch");
  }
}

if (backupBytes.subarray(0, 5).toString("ascii") !== "PGDMP") {
  fail("backup is not a PostgreSQL custom-format dump");
}

const name = `main-service-restore-verify-${Date.now()}`;
const password = "restore_verify_password";

let restoreFailure;
try {
  run("docker", [
    "run",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_USER=restore_verify",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_DB=restore_verify",
    "postgres:17.9-bookworm"
  ]);
  waitForPostgres(name);
  run("docker", ["cp", backupPath, `${name}:/tmp/backup.dump`]);
  run("docker", ["exec", "-e", `PGPASSWORD=${password}`, name, "pg_restore", "--no-owner", "--exit-on-error", "-h", "127.0.0.1", "-U", "restore_verify", "-d", "restore_verify", "/tmp/backup.dump"]);
  const tables = dockerOutput([
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    name,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "restore_verify",
    "-d",
    "restore_verify",
    "-Atc",
    "select count(*) from information_schema.tables where table_schema='public' and table_name in ('feeds','entries','entry_details','site_feeds','agent_feed_check_events','agent_runtime_status');"
  ]);
  const migrations = dockerOutput([
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    name,
    "psql",
    "-h",
    "127.0.0.1",
    "-U",
    "restore_verify",
    "-d",
    "restore_verify",
    "-Atc",
    "select count(*) from _prisma_migrations where migration_name in ('20260620000000_initial_empty','20260620001000_canonical_business_schema');"
  ]);
  if (tables.trim() !== "6" || migrations.trim() !== "2") {
    throw new Error(`restore catalog mismatch: tables=${tables.trim()} migrations=${migrations.trim()}`);
  }
  verifySentinelRows(name, password, metadata);
  console.log("production-restore-verify: ok");
} catch (error) {
  restoreFailure = error;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", shell: false });
}
if (restoreFailure !== undefined) {
  fail(restoreFailure.message);
}

function verifySentinelRows(containerName, password, backupMetadata) {
  const expected = backupMetadata?.sentinel?.expected_counts;
  if (expected === undefined) {
    return;
  }
  const checks = [
    ["feeds", "select count(*) from feeds;", expected.feeds],
    ["site_feeds", "select count(*) from site_feeds;", expected.site_feeds],
    ["entries", "select count(*) from entries;", expected.entries],
    ["entry_details", "select count(*) from entry_details;", expected.entry_details],
    ["agent_feed_check_events", "select count(*) from agent_feed_check_events;", expected.agent_feed_check_events],
    ["agent_runtime_status", "select count(*) from agent_runtime_status where status='ok';", expected.agent_runtime_status],
    ["entry_detail_invariant", "select count(*) from entries e join entry_details d on d.entry_id=e.id and d.feed_id=e.feed_id where e.has_detail=true;", 1],
    ["agent_event_present", "select count(*) from agent_feed_check_events where outcome='entries_found';", 1]
  ];
  for (const [label, sql, minimum] of checks) {
    const actual = Number(dockerOutput([
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
    ]).trim());
    if (!Number.isFinite(actual) || actual < Number(minimum)) {
      throw new Error(`restore sentinel mismatch: ${label}=${actual}`);
    }
  }
}

function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync("docker", [
      "exec",
      "-e",
      "PGPASSWORD=restore_verify_password",
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
    ], {
      stdio: "ignore",
      shell: false
    });
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  fail("restore verification PostgreSQL did not become ready");
}

function dockerOutput(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "docker output command failed");
  }
  return result.stdout;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed`);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
