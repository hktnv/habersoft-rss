import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const composeFile = args["compose-file"];
const envFile = args["env-file"];
const runtimeImageEnv = args["runtime-image-env"];
const output = args.output;
const project = args.project;

if (composeFile === undefined || envFile === undefined || output === undefined) {
  fail("production:backup requires --compose-file <path> --env-file <path> --output <backup.dump>");
}

const env = parseEnvFile(envFile);
const outputPath = path.resolve(output);
mkdirSync(path.dirname(outputPath), { recursive: true });

const composeArgs = ["compose"];
if (project !== undefined) {
  composeArgs.push("-p", project);
}
composeArgs.push("--env-file", envFile);
if (runtimeImageEnv !== undefined) {
  composeArgs.push("--env-file", runtimeImageEnv);
}
composeArgs.push("-f", composeFile, "exec", "-T", "postgres", "pg_dump", "-Fc", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB);

const result = spawnSync("docker", composeArgs, { shell: process.platform === "win32" });
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

writeFileSync(outputPath, result.stdout);
const metadata = {
  schema_version: 1,
  format: "pg_dump custom",
  postgres_image: "postgres:17.9-bookworm",
  database: env.POSTGRES_DB,
  created_at: new Date().toISOString(),
  sha256: sha256(result.stdout)
};
writeFileSync(`${outputPath}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`production-backup: ok ${outputPath}`);

function parseEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
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
