import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SCRIPT_NAME = "repository-hygiene-verify";
const args = parseArgs(process.argv.slice(2));
const backendRoot = path.resolve(args.root ?? process.cwd());
const repoRoot = resolveRepoRoot(backendRoot);
const backendPrefix = path.relative(repoRoot, backendRoot).replaceAll(path.sep, "/");
const collectorPath = "scripts/production-operational-evidence-collector.sh";
const productionGuidePath = "PRODUCTION.md";
const attributesGitPath = ".gitattributes";
const defaultHandoff = path.resolve(repoRoot, "operator-state", "ms-019a", "production-operational-evidence-handoff");
const handoffDir = args.handoff === "false" ? undefined : path.resolve(args.handoff ?? defaultHandoff);
const failures = [];

requireFile(path.join(repoRoot, attributesGitPath), attributesGitPath);
requireFile(path.join(backendRoot, productionGuidePath), `${backendPrefix}/${productionGuidePath}`);
requireFile(path.join(backendRoot, collectorPath), `${backendPrefix}/${collectorPath}`);

const trackedShellPaths = collectTrackedShellPaths();
assertAttributes();
assertNoCarriageReturn(path.join(repoRoot, attributesGitPath), attributesGitPath);
assertNoCarriageReturn(path.join(backendRoot, productionGuidePath), `${backendPrefix}/${productionGuidePath}`);
for (const shellPath of trackedShellPaths) {
  assertNoCarriageReturn(path.join(backendRoot, shellPath), `${backendPrefix}/${shellPath}`);
}
assertGitStateIfAvailable();
for (const shellPath of trackedShellPaths) {
  assertBashSyntaxIfAvailable(path.join(backendRoot, shellPath), `${backendPrefix}/${shellPath}`);
}
assertProductionOwnership();
assertHandoffIfPresent();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${SCRIPT_NAME}: ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: "repository-hygiene-ok",
  root: backendRoot,
  repo_root: repoRoot,
  production_mirror_checked: false,
  production_mirror_contract: "retired",
  handoff_checked: handoffDir !== undefined && existsSync(handoffDir)
}, null, 2));

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push(`required file missing: ${label}`);
  }
}

function assertAttributes() {
  const attributesFile = path.join(repoRoot, attributesGitPath);
  if (!existsSync(attributesFile)) {
    return;
  }
  const text = readFileSync(attributesFile, "utf8");
  const normalizedLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line !== "" && !line.startsWith("#"));

  const expected = [
    ".gitattributes text eol=lf",
    "rss-habersoft-com/scripts/*.sh text eol=lf",
    "PRODUCTION.md text eol=lf",
    "rss-habersoft-com/PRODUCTION.md text eol=lf",
    "rss-admin-ui/PRODUCTION.md text eol=lf"
  ];
  for (const line of expected) {
    if (!normalizedLines.includes(line)) failures.push(`.gitattributes missing rule: ${line}`);
  }
  if (normalizedLines.some((line) => /^\*\.md\s+.*\beol=lf\b/u.test(line))) {
    failures.push(".gitattributes must not force all Markdown files to LF without review");
  }
}

function assertNoCarriageReturn(file, label) {
  if (!existsSync(file)) return;
  const bytes = readFileSync(file);
  if (bytes.includes(13)) failures.push(`${label} contains CR byte`);
}

function assertGitStateIfAvailable() {
  if (!existsSync(path.join(repoRoot, ".git"))) return;
  const paths = [
    attributesGitPath,
    `${backendPrefix}/${productionGuidePath}`,
    ...trackedShellPaths.map((relative) => `${backendPrefix}/${relative}`)
  ];
  const attr = git(["check-attr", "text", "eol", "--", ...paths], { cwd: repoRoot });
  if (attr.status !== 0) {
    failures.push("git check-attr failed");
  } else {
    for (const relative of paths) {
      const textLine = attr.stdout.split(/\r?\n/u).find((line) => line.startsWith(`${relative}: text:`));
      const eolLine = attr.stdout.split(/\r?\n/u).find((line) => line.startsWith(`${relative}: eol:`));
      if (!textLine?.endsWith("set") || !eolLine?.endsWith("lf")) {
        failures.push(`git attributes not effective for ${relative}`);
      }
    }
  }

  const trackedPaths = paths.filter((relative) => git(["ls-files", "--error-unmatch", "--", relative], { cwd: repoRoot }).status === 0);
  const eol = git(["ls-files", "--eol", "--", ...trackedPaths], { cwd: repoRoot });
  if (eol.status !== 0) {
    failures.push("git ls-files --eol failed");
  } else {
    for (const relative of trackedPaths) {
      const line = eol.stdout.split(/\r?\n/u).find((entry) => entry.endsWith(`\t${relative}`));
      if (!line || !line.includes("i/lf") || !line.includes("w/lf") || !line.includes("attr/text eol=lf")) {
        failures.push(`git eol state invalid for ${relative}`);
      }
    }
  }

  for (const relative of trackedPaths) {
    const blob = git(["show", `:${relative}`], { cwd: repoRoot, encoding: "buffer" });
    if (blob.status !== 0) {
      failures.push(`git blob read failed for ${relative}`);
      continue;
    }
    if (blob.stdout.includes(13)) failures.push(`${relative} Git blob contains CR byte`);
  }
}

function assertBashSyntaxIfAvailable(file, label) {
  const bash = spawnSync("bash", ["--version"], { cwd: backendRoot, encoding: "utf8", shell: false });
  if (bash.error !== undefined || bash.status !== 0) return;
  const result = spawnSync("bash", ["-n", toBashPath(file)], { cwd: backendRoot, encoding: "utf8", shell: false });
  if (result.status !== 0) failures.push(`${label} bash -n failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
}

function toBashPath(file) {
  const relative = path.relative(backendRoot, path.resolve(file));
  if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }
  if (process.platform !== "win32") return path.resolve(file);
  const normalized = path.resolve(file).replaceAll("\\", "/");
  const drivePath = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  return drivePath ? `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2]}` : normalized;
}

function assertProductionOwnership() {
  const rootGuide = path.join(repoRoot, "PRODUCTION.md");
  const backendGuide = path.join(backendRoot, productionGuidePath);
  const frontendGuide = path.join(repoRoot, "rss-admin-ui", "PRODUCTION.md");
  for (const file of [rootGuide, backendGuide, frontendGuide]) {
    if (!existsSync(file)) failures.push(`production guide missing: ${path.relative(repoRoot, file).replaceAll(path.sep, "/")}`);
  }
  if (existsSync(rootGuide) && existsSync(backendGuide)) {
    const rootSha = sha256(readFileSync(rootGuide));
    const backendSha = sha256(readFileSync(backendGuide));
    if (rootSha === backendSha) failures.push("root and backend production guides must not be byte-identical");
  }
}

function assertHandoffIfPresent() {
  if (handoffDir === undefined || !existsSync(handoffDir)) return;
  const scripts = readdirSync(handoffDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
    .map((entry) => path.join(handoffDir, entry.name));
  if (scripts.length === 0) {
    failures.push("handoff shell script missing");
    return;
  }
  for (const script of scripts) {
    const label = path.basename(script) === "collect-production-operational-evidence.sh"
      ? "generated handoff collector"
      : `generated handoff script ${path.basename(script)}`;
    assertNoCarriageReturn(script, label);
    assertBashSyntaxIfAvailable(script, label);
  }
}

function collectTrackedShellPaths() {
  const scriptsDir = path.join(backendRoot, "scripts");
  if (!existsSync(scriptsDir)) return [collectorPath];
  return readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sh"))
    .map((entry) => `scripts/${entry.name}`)
    .sort();
}

function resolveRepoRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status === 0) return path.resolve(result.stdout.trim());
  return path.resolve(cwd, "..");
}

function git(gitArgs, options = {}) {
  const result = spawnSync("git", gitArgs, {
    cwd: options.cwd ?? backendRoot,
    encoding: options.encoding ?? "utf8",
    shell: false
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? (options.encoding === "buffer" ? Buffer.alloc(0) : ""),
    stderr: result.stderr ?? ""
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    parsed[key] = next === undefined || next.startsWith("--") ? "true" : next;
    if (parsed[key] !== "true") index += 1;
  }
  return parsed;
}
