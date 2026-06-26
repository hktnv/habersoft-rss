import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
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
const RECEIPT_FILENAME = "backup-capture-receipt.json";
const CHECKSUMS_FILENAME = "checksums.sha256";
const COMPOSE_CONTEXT_MODE = "EXPLICIT_PRODUCTION_COMPOSE_TWO_ENV_FILES";
const TOOL_NAME = "production-backup";
const DOCKER_BIN = process.env.MS019C_DOCKER_BIN ?? "docker";
const DOCKER_FAKE_SCRIPT = process.env.MS019C_DOCKER_FAKE_SCRIPT;
const KNOWN_FLAGS = new Set([
  "compose-file",
  "shared-env",
  "env-file",
  "runtime-image-env",
  "output-dir",
  "output",
  "handoff-source-commit",
  "handoff-capture-script-sha256",
  "project"
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
  if (args["output-dir"] !== undefined) {
    assert(args.output === undefined, "output and output-dir modes cannot be combined");
    assert(args["shared-env"] !== undefined, "output-dir mode requires --shared-env");
    assert(args["env-file"] === undefined, "output-dir mode uses --shared-env; use --env-file only with --output");
    captureBundle(args);
  } else {
    assert(args["shared-env"] === undefined, "legacy output mode uses --env-file; use --shared-env only with --output-dir");
    captureLegacyDump(args);
  }
} catch (error) {
  fail(error.message);
}

function describeContract() {
  console.log(JSON.stringify({
    schema_version: 1,
    tool_name: TOOL_NAME,
    contract_version: CONTRACT_VERSION,
    accepted_input_mode: "bundle-directory-and-legacy-file",
    bundle_mode: {
      required_flags: ["--compose-file", "--shared-env", "--runtime-image-env", "--output-dir"],
      optional_flags: ["--project", "--handoff-source-commit", "--handoff-capture-script-sha256"],
      output_mode: "directory",
      output_files: [DUMP_FILENAME, METADATA_FILENAME, RECEIPT_FILENAME, CHECKSUMS_FILENAME]
    },
    legacy_file_mode: {
      required_flags: ["--compose-file", "--env-file", "--output"],
      optional_flags: ["--runtime-image-env", "--project"],
      output_mode: "single-dump-file-plus-metadata"
    },
    backup_format: "POSTGRESQL_CUSTOM",
    compose_context_mode: COMPOSE_CONTEXT_MODE,
    production_contact_performed_by_contract_probe: false,
    production_mutation_performed: false,
    deployment_performed: false,
    migration_performed: false,
    secrets_included: false
  }, null, 2));
}

function printUsage() {
  console.log([
    "usage:",
    "  production-backup contract:describe",
    "  production-backup --compose-file <path> --shared-env <path> --runtime-image-env <path> --output-dir <new-empty-dir>",
    "  production-backup --compose-file <path> --env-file <path> [--runtime-image-env <path>] --output <backup.dump>"
  ].join("\n"));
}

function captureBundle(options) {
  const composeFile = requiredPath(options["compose-file"], "compose-file");
  const sharedEnv = requiredPath(options["shared-env"] ?? options["env-file"], "shared-env");
  const runtimeImageEnv = requiredPath(options["runtime-image-env"], "runtime-image-env");
  const outputDir = path.resolve(requiredValue(options["output-dir"], "output-dir"));
  prepareEmptyOutputDirectory(outputDir);

  const dumpPath = path.join(outputDir, DUMP_FILENAME);
  const tempDumpPath = path.join(outputDir, `${DUMP_FILENAME}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  const env = parseEnvFile(sharedEnv);
  runPgDump({ composeFile, sharedEnv, runtimeImageEnv, project: options.project, env, outputPath: tempDumpPath });
  assertCustomDump(tempDumpPath);
  renameSync(tempDumpPath, dumpPath);

  const dumpBytes = readFileSync(dumpPath);
  const captureUtc = new Date().toISOString();
  const backupSha = sha256(dumpBytes);
  const metadata = {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    metadata_type: "production-backup-capture-metadata",
    milestone: "MS-019C",
    service: RELEASE_IDENTITY.application,
    environment: "production",
    captured_at_utc: captureUtc,
    backup_format: "POSTGRESQL_CUSTOM",
    backup_filename: DUMP_FILENAME,
    backup_bytes: dumpBytes.length,
    backup_sha256: backupSha,
    postgres_image: POSTGRES_IMAGE,
    compose_context_mode: COMPOSE_CONTEXT_MODE,
    expected_migrations: [...EXPECTED_MIGRATIONS],
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    production_mutation_performed: false,
    deployment_performed: false,
    migration_performed: false,
    restore_performed: false,
    secrets_included: false
  };
  const receipt = {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    receipt_type: "production-backup-capture",
    milestone: "MS-019C",
    service: RELEASE_IDENTITY.application,
    environment: "production",
    application_version: RELEASE_IDENTITY.version,
    application_status: RELEASE_IDENTITY.status,
    captured_at_utc: captureUtc,
    parent_ms019b_operational_receipt_sha256: PARENT_OPERATIONAL_RECEIPT_SHA256,
    handoff: {
      source_commit: options["handoff-source-commit"] ?? gitOutput(["rev-parse", "HEAD"]),
      capture_script_sha256: options["handoff-capture-script-sha256"] ?? "NOT_RECORDED"
    },
    compose_context: {
      mode: COMPOSE_CONTEXT_MODE,
      compose_file_role: "deploy/production/compose.yaml",
      shared_env_role: "external production shared env",
      runtime_image_env_role: "deploy/runtime-image.env",
      no_bare_compose: true
    },
    backup: {
      filename: DUMP_FILENAME,
      format: "POSTGRESQL_CUSTOM",
      bytes: dumpBytes.length,
      sha256: backupSha,
      checksum_computed_after_close: true
    },
    postgres: {
      image: POSTGRES_IMAGE,
      client_major: "NOT_RECORDED",
      server_major: "NOT_RECORDED"
    },
    expected_migrations: [...EXPECTED_MIGRATIONS],
    production_contact_performed_by_codex: false,
    production_mutation_performed: false,
    deployment_performed: false,
    migration_performed: false,
    backup_performed: true,
    restore_performed: false,
    artifact_publication_performed: false,
    git_tag_created: false,
    github_release_created: false,
    secrets_included: false
  };

  assertSafeReceipt(metadata, "metadata");
  assertSafeReceipt(receipt, "receipt");
  writeJson(path.join(outputDir, METADATA_FILENAME), metadata, 0o600);
  writeJson(path.join(outputDir, RECEIPT_FILENAME), receipt, 0o600);
  writeChecksums(outputDir, [DUMP_FILENAME, METADATA_FILENAME, RECEIPT_FILENAME]);

  console.log(JSON.stringify({
    status: "production-backup-capture-created",
    output_dir: outputDir,
    backup_filename: DUMP_FILENAME,
    backup_sha256: backupSha,
    backup_bytes: dumpBytes.length,
    production_mutation_performed: false,
    restore_performed: false,
    secrets_included: false
  }, null, 2));
}

function captureLegacyDump(options) {
  const composeFile = requiredPath(options["compose-file"], "compose-file");
  const sharedEnv = requiredPath(options["env-file"], "env-file");
  const runtimeImageEnv = options["runtime-image-env"];
  const output = requiredValue(options.output, "output");
  const outputPath = path.resolve(output);
  assert(!existsSync(outputPath), "output backup must not already exist");
  mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });

  const tempDumpPath = `${outputPath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const env = parseEnvFile(sharedEnv);
  runPgDump({ composeFile, sharedEnv, runtimeImageEnv, project: options.project, env, outputPath: tempDumpPath });
  assertCustomDump(tempDumpPath);
  renameSync(tempDumpPath, outputPath);
  const dumpBytes = readFileSync(outputPath);
  const metadata = {
    schema_version: 1,
    contract_version: CONTRACT_VERSION,
    format: "POSTGRESQL_CUSTOM",
    postgres_image: POSTGRES_IMAGE,
    created_at: new Date().toISOString(),
    sha256: sha256(dumpBytes)
  };
  assertSafeReceipt(metadata, "legacy metadata");
  writeJson(`${outputPath}.metadata.json`, metadata, 0o600);
  console.log(`production-backup: ok ${outputPath}`);
}

function runPgDump({ composeFile, sharedEnv, runtimeImageEnv, project, env, outputPath }) {
  assert(env.POSTGRES_USER !== undefined && env.POSTGRES_USER !== "", "POSTGRES_USER is required");
  assert(env.POSTGRES_DB !== undefined && env.POSTGRES_DB !== "", "POSTGRES_DB is required");
  const composeArgs = ["compose"];
  if (project !== undefined) {
    composeArgs.push("-p", project);
  }
  composeArgs.push("--env-file", sharedEnv);
  if (runtimeImageEnv !== undefined) {
    composeArgs.push("--env-file", runtimeImageEnv);
  }
  composeArgs.push("-f", composeFile, "exec", "-T", "postgres", "pg_dump", "-Fc", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB);

  let fd;
  try {
    fd = openSync(outputPath, "wx", 0o600);
    const result = spawnDocker(composeArgs, {
      stdio: ["ignore", fd, "pipe"],
      shell: process.platform === "win32"
    });
    if (result.status !== 0) {
      rmSync(outputPath, { force: true });
      fail("pg_dump failed; raw stderr suppressed");
    }
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function prepareEmptyOutputDirectory(outputDir) {
  if (existsSync(outputDir)) {
    assert(statSync(outputDir).isDirectory(), "output-dir must be a directory");
    assert(readdirSync(outputDir).length === 0, "output-dir must be empty");
    return;
  }
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
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

function assertCustomDump(file) {
  const bytes = readFileSync(file);
  assert(bytes.length >= 5, "backup dump is too small");
  assert(bytes.subarray(0, 5).toString("ascii") === "PGDMP", "backup is not a PostgreSQL custom-format dump");
}

function writeChecksums(directory, files) {
  const lines = files.map((file) => `${sha256(readFileSync(path.join(directory, file)))}  ${file}`);
  writeFileSync(path.join(directory, CHECKSUMS_FILENAME), `${lines.join("\n")}\n`, { mode: 0o600 });
}

function writeJson(file, value, mode) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function parseEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        assert(separator > 0, "invalid env line");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

function assertSafeReceipt(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    /DATABASE_URL/iu,
    /POSTGRES_PASSWORD/iu,
    /TENANT_RATE_LIMIT_KEY_SECRET/iu,
    /AGENT_KEY/iu,
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

function requiredPath(value, label) {
  const resolved = path.resolve(requiredValue(value, label));
  assert(existsSync(resolved), `${label} does not exist`);
  return resolved;
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

function gitOutput(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    return "NOT_RECORDED";
  }
  return result.stdout.trim();
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
  console.error(`production-backup: ${message}`);
  process.exit(1);
}
