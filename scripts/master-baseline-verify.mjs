import path from "node:path";
import { computeMasterTreeHash, RELEASE_IDENTITY, verifyMasterBaseline } from "./release-identity.mjs";

const args = parseArgs(process.argv.slice(2));
const masterDir = path.resolve(args["master-dir"] ?? path.join("..", ".md", "master"));
const json = args.json === "true";

try {
  const verified = verifyMasterBaseline(masterDir);
  if (json) {
    process.stdout.write(`${JSON.stringify(toJson(verified), null, 2)}\n`);
  } else {
    console.log(`master-baseline-verify: ok`);
    console.log(`release=${RELEASE_IDENTITY.masterRelease}`);
    console.log(`count=${verified.count}`);
    console.log(`sha256=${verified.sha256}`);
    console.log(`first=${verified.firstPath}`);
    console.log(`last=${verified.lastPath}`);
  }
} catch (error) {
  const actual = computeMasterTreeHash(masterDir);
  if (json) {
    process.stdout.write(`${JSON.stringify(toJson(actual), null, 2)}\n`);
  }
  console.error(`master-baseline-verify: ${error.message}`);
  process.exit(1);
}

function toJson(result) {
  return {
    release: RELEASE_IDENTITY.masterRelease,
    expected_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    expected_sha256: RELEASE_IDENTITY.masterSha256,
    count: result.count,
    sha256: result.sha256,
    first_path: result.firstPath,
    last_path: result.lastPath,
    files: result.inventory.map((file) => ({
      path: file.relativePath,
      sha256: file.sha256,
      has_utf8_bom: file.hasUtf8Bom,
      line_endings: file.lineEndings
    }))
  };
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
