import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_PUBLIC_ROUTES,
  EXPECTED_SERVICES,
  RELEASE_IDENTITY,
  verifyMasterBaseline
} from "./release-identity.mjs";

const args = parseArgs(process.argv.slice(2));
const output = args.output;
const platform = args.platform ?? "linux/amd64";
const image = args.image ?? `main-service-app:${RELEASE_IDENTITY.version}`;
const includeImage = args["no-image"] !== "true";
const allowDirty = args["allow-dirty"] === "true";

if (output === undefined) {
  fail("release:package requires --output <directory>");
}

const outputDir = path.resolve(output);
mkdirSync(outputDir, { recursive: true });
mkdirSync(path.join(outputDir, "deploy", "production"), { recursive: true });
mkdirSync(path.join(outputDir, "metadata"), { recursive: true });

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (packageJson.version !== RELEASE_IDENTITY.version) {
  fail(`package.json version must be ${RELEASE_IDENTITY.version}`);
}

const masterBaseline = verifyBaseline(args["master-dir"]);
const sourceCommit = getGitCommit(allowDirty);

copyFileSync("deploy/production/compose.yaml", path.join(outputDir, "deploy", "production", "compose.yaml"));
copyFileSync("deploy/production/production.env.template", path.join(outputDir, "deploy", "production", "production.env.template"));

const imageMetadata = inspectImage(image, includeImage);
if (includeImage) {
  run("docker", ["save", "--output", path.join(outputDir, "main-service-image.tar"), image]);
}

const sbom = createSbom();
const manifest = {
  schema_version: 1,
  application: RELEASE_IDENTITY.application,
  version: RELEASE_IDENTITY.version,
  status: RELEASE_IDENTITY.status,
  master_release: RELEASE_IDENTITY.masterRelease,
  master_sha256: RELEASE_IDENTITY.masterSha256,
  master_active_markdown_count: masterBaseline.count,
  production_deployed: RELEASE_IDENTITY.productionDeployed,
  release_published: RELEASE_IDENTITY.releasePublished,
  source_commit: sourceCommit,
  platform,
  image: imageMetadata,
  services: [...EXPECTED_SERVICES],
  public_routes: [...EXPECTED_PUBLIC_ROUTES],
  migrations: readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  sbom: {
    generator: "npm sbom --sbom-format=cyclonedx --json",
    bom_format: sbom.bomFormat,
    spec_version: sbom.specVersion,
    component_count: Array.isArray(sbom.components) ? sbom.components.length : 0
  },
  provenance_level: "local metadata",
  attestation_level: "unsigned provenance",
  created_at: new Date().toISOString()
};

if (JSON.stringify(manifest.migrations) !== JSON.stringify(EXPECTED_MIGRATIONS)) {
  fail(`migration inventory mismatch: ${manifest.migrations.join(", ")}`);
}

writeJson(path.join(outputDir, "manifest.json"), manifest);
writeJson(path.join(outputDir, "metadata", "sbom.cdx.json"), sbom);
writeJson(path.join(outputDir, "metadata", "provenance.json"), createProvenance(manifest));
writeChecksums(outputDir);

console.log(`release-package: ok ${outputDir}`);

function inspectImage(imageRef, required) {
  const result = spawnSync("docker", ["image", "inspect", imageRef], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    if (required) {
      process.stderr.write(result.stderr);
      fail(`image not found: ${imageRef}`);
    }
    return { reference: imageRef, included: false };
  }

  const [inspect] = JSON.parse(result.stdout);
  return {
    reference: imageRef,
    included: required,
    id: inspect.Id,
    repo_digests: inspect.RepoDigests ?? [],
    created: inspect.Created,
    architecture: inspect.Architecture,
    os: inspect.Os
  };
}

function createSbom() {
  const result = spawnSync("npm", ["sbom", "--sbom-format=cyclonedx", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    fail("npm CycloneDX SBOM generation failed");
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("npm CycloneDX SBOM output was not valid JSON");
  }
}

function createProvenance(manifest) {
  return {
    schema_version: 1,
    application: manifest.application,
    version: manifest.version,
    source_commit: manifest.source_commit,
    master_release: manifest.master_release,
    master_sha256: manifest.master_sha256,
    master_active_markdown_count: manifest.master_active_markdown_count,
    platform: manifest.platform,
    image: manifest.image,
    builder: "local Docker Engine / Docker Compose verification",
    provenance_level: "local metadata",
    attestation_level: "unsigned provenance",
    sbom: manifest.sbom,
    external_registry_push: false,
    git_tag_created: false,
    github_release_created: false,
    staging_deployed: false,
    production_deployed: false,
    buildkit_attestation: false,
    signed_attestation: false,
    generated_at: manifest.created_at
  };
}

function writeChecksums(directory) {
  const files = collectFiles(directory)
    .filter((file) => path.basename(file) !== "checksums.sha256")
    .sort();
  const lines = files.map((file) => {
    const relative = path.relative(directory, file).replaceAll(path.sep, "/");
    return `${sha256(readFileSync(file))}  ${relative}`;
  });
  writeFileSync(path.join(directory, "checksums.sha256"), `${lines.join("\n")}\n`);
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return entry.isFile() ? [fullPath] : [];
  });
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", shell: process.platform === "win32" });
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
    const next = rawArgs[index + 1];
    result[arg.slice(2)] = next?.startsWith("--") || next === undefined ? "true" : next;
    if (result[arg.slice(2)] !== "true") {
      index += 1;
    }
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function getGitCommit(allowDirtyTree) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    fail("git source commit could not be determined");
  }
  if (!allowDirtyTree) {
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    if (status.status !== 0) {
      process.stderr.write(status.stderr);
      fail("git working tree status could not be determined");
    }
    if (status.stdout.trim() !== "") {
      fail("git working tree must be clean for release package generation; use --allow-dirty true only for local tests");
    }
  }
  return result.stdout.trim();
}

function verifyBaseline(masterDir) {
  try {
    return verifyMasterBaseline(masterDir === undefined ? undefined : path.resolve(masterDir));
  } catch (error) {
    fail(`master baseline verification failed: ${error.message}`);
  }
}
