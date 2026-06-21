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
if (existsSync(metadataPath)) {
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.sha256 !== sha256(backupBytes)) {
    fail("backup checksum mismatch");
  }
}

if (backupBytes.subarray(0, 5).toString("ascii") !== "PGDMP") {
  fail("backup is not a PostgreSQL custom-format dump");
}

const name = `main-service-restore-verify-${Date.now()}`;
const password = "restore_verify_password";

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
  run("docker", ["exec", "-e", `PGPASSWORD=${password}`, name, "pg_restore", "--no-owner", "--exit-on-error", "-U", "restore_verify", "-d", "restore_verify", "/tmp/backup.dump"]);
  const tables = dockerOutput([
    "exec",
    "-e",
    `PGPASSWORD=${password}`,
    name,
    "psql",
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
    "-U",
    "restore_verify",
    "-d",
    "restore_verify",
    "-Atc",
    "select count(*) from _prisma_migrations where migration_name in ('20260620000000_initial_empty','20260620001000_canonical_business_schema');"
  ]);
  if (tables.trim() !== "6" || migrations.trim() !== "2") {
    fail(`restore catalog mismatch: tables=${tables.trim()} migrations=${migrations.trim()}`);
  }
  console.log("production-restore-verify: ok");
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", shell: false });
}

function waitForPostgres(containerName) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync("docker", [
      "exec",
      "-e",
      "PGPASSWORD=restore_verify_password",
      containerName,
      "psql",
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
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
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
