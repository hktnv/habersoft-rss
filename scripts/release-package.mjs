import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const version = "0.1.0-ms-016";
const args = parseArgs(process.argv.slice(2));
const output = args.output;
const platform = args.platform ?? "linux/amd64";
const image = args.image ?? `main-service-app:${version}`;
const includeImage = args["no-image"] !== "true";

if (output === undefined) {
  fail("release:package requires --output <directory>");
}

const outputDir = path.resolve(output);
mkdirSync(outputDir, { recursive: true });
mkdirSync(path.join(outputDir, "deploy", "production"), { recursive: true });
mkdirSync(path.join(outputDir, "metadata"), { recursive: true });

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (packageJson.version !== version) {
  fail(`package.json version must be ${version}`);
}

copyFileSync("deploy/production/compose.yaml", path.join(outputDir, "deploy", "production", "compose.yaml"));
copyFileSync("deploy/production/production.env.template", path.join(outputDir, "deploy", "production", "production.env.template"));

const imageMetadata = inspectImage(image, includeImage);
if (includeImage) {
  run("docker", ["save", "--output", path.join(outputDir, "main-service-image.tar"), image]);
}

const manifest = {
  schema_version: 1,
  application: "main-service",
  version,
  status: "MVP Adayi - Deployment Karari Kesin / Release Paketi Dogrulandi",
  master_release: "rss-habersoft-master-v12",
  master_sha256: "df466d84859edcf17d91e797b490c07059f37d5a6ad5ba3c17ddc987a2ac0430",
  production_deployed: false,
  release_published: false,
  platform,
  image: imageMetadata,
  services: ["postgres", "redis", "migrate", "main-service-api", "main-service-worker"],
  public_routes: [
    "GET /health/live",
    "GET /health/ready",
    "POST /api/feeds",
    "GET /api/feeds",
    "DELETE /api/feeds/{feed_id}",
    "GET /api/entries",
    "GET /api/entries/{id}/detail",
    "POST /agent/heartbeat",
    "GET /agent/feeds/due",
    "POST /agent/feeds/{feed_id}/new-guids",
    "POST /agent/entries",
    "POST /agent/feed-check-results"
  ],
  migrations: readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  created_at: new Date().toISOString()
};

writeJson(path.join(outputDir, "manifest.json"), manifest);
writeJson(path.join(outputDir, "metadata", "sbom.cdx.json"), createSbom(packageJson));
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

function createSbom(packageJson) {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const components = Object.entries(lock.packages ?? {})
    .filter(([name, value]) => name.startsWith("node_modules/") && value.version !== undefined)
    .map(([name, value]) => ({
      type: "library",
      name: name.replace("node_modules/", ""),
      version: value.version,
      purl: `pkg:npm/${encodeURIComponent(name.replace("node_modules/", ""))}@${value.version}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: packageJson.name,
        version: packageJson.version
      }
    },
    components
  };
}

function createProvenance(manifest) {
  const gitCommit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", shell: process.platform === "win32" });
  return {
    schema_version: 1,
    application: manifest.application,
    version: manifest.version,
    git_commit: gitCommit.status === 0 ? gitCommit.stdout.trim() : "unknown",
    platform: manifest.platform,
    builder: "local Docker Engine / Docker Compose verification",
    external_registry_push: false,
    git_tag_created: false,
    github_release_created: false
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
