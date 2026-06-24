import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SCRIPT_NAME = "repository-hygiene-verify";
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? process.cwd());
const collectorPath = "scripts/production-operational-evidence-collector.sh";
const productionGuidePath = "PRODUCTION.md";
const attributesPath = ".gitattributes";
const defaultMirror = path.resolve(root, "..", "PRODUCTION.md");
const defaultHandoff = path.resolve(root, "..", "operator-state", "ms-019a", "production-operational-evidence-handoff");
const mirrorFile = args["production-mirror"] === "false" ? undefined : path.resolve(args["production-mirror"] ?? defaultMirror);
const handoffDir = args.handoff === "false" ? undefined : path.resolve(args.handoff ?? defaultHandoff);
const failures = [];

requireFile(attributesPath);
requireFile(productionGuidePath);
requireFile(collectorPath);
assertAttributes();
assertNoCarriageReturn(path.join(root, attributesPath), `${attributesPath} worktree`);
assertNoCarriageReturn(path.join(root, productionGuidePath), `${productionGuidePath} worktree`);
assertNoCarriageReturn(path.join(root, collectorPath), `${collectorPath} worktree`);
assertGitStateIfAvailable();
assertBashSyntaxIfAvailable(path.join(root, collectorPath), collectorPath);
assertMirrorIfPresent();
assertHandoffIfPresent();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${SCRIPT_NAME}: ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: "repository-hygiene-ok",
  root,
  production_mirror_checked: mirrorFile !== undefined && existsSync(mirrorFile),
  handoff_checked: handoffDir !== undefined && existsSync(handoffDir)
}, null, 2));

function requireFile(relative) {
  const file = path.join(root, relative);
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push(`required file missing: ${relative}`);
  }
}

function assertAttributes() {
  const file = path.join(root, attributesPath);
  if (!existsSync(file)) {
    return;
  }

  const text = readFileSync(file, "utf8");
  const normalizedLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line !== "" && !line.startsWith("#"));

  const hasSelf = normalizedLines.includes(".gitattributes text eol=lf");
  const hasShell =
    normalizedLines.includes("scripts/*.sh text eol=lf") ||
    normalizedLines.includes("scripts/production-operational-evidence-collector.sh text eol=lf");
  const hasProductionGuide = normalizedLines.includes("PRODUCTION.md text eol=lf");
  const hasBroadMarkdown = normalizedLines.some((line) => /^\*\.md\s+.*\beol=lf\b/u.test(line));

  if (!hasSelf) {
    failures.push(".gitattributes missing self LF rule");
  }
  if (!hasShell) {
    failures.push(".gitattributes missing shell LF rule");
  }
  if (!hasProductionGuide) {
    failures.push(".gitattributes missing PRODUCTION.md LF rule");
  }
  if (hasBroadMarkdown) {
    failures.push(".gitattributes must not force all Markdown files to LF without review");
  }
}

function assertNoCarriageReturn(file, label) {
  if (!existsSync(file)) {
    return;
  }
  const bytes = readFileSync(file);
  if (bytes.includes(13)) {
    failures.push(`${label} contains CR byte`);
  }
}

function assertGitStateIfAvailable() {
  if (!existsSync(path.join(root, ".git"))) {
    return;
  }

  const paths = [attributesPath, productionGuidePath, collectorPath];
  const attr = git(["check-attr", "text", "eol", "--", ...paths]);
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

  const eol = git(["ls-files", "--eol", "--", ...paths]);
  if (eol.status !== 0) {
    failures.push("git ls-files --eol failed");
  } else {
    for (const relative of paths) {
      const line = eol.stdout.split(/\r?\n/u).find((entry) => entry.endsWith(`\t${relative}`));
      if (!line || !line.includes("i/lf") || !line.includes("w/lf") || !line.includes("attr/text eol=lf")) {
        failures.push(`git eol state invalid for ${relative}`);
      }
    }
  }

  for (const relative of paths) {
    const blob = git(["show", `HEAD:${relative}`], { encoding: "buffer" });
    if (blob.status !== 0) {
      failures.push(`git blob read failed for ${relative}`);
      continue;
    }
    if (blob.stdout.includes(13)) {
      failures.push(`${relative} Git blob contains CR byte`);
    }
  }
}

function assertBashSyntaxIfAvailable(file, label) {
  const bash = spawnSync("bash", ["--version"], { cwd: root, encoding: "utf8", shell: false });
  if (bash.error !== undefined || bash.status !== 0) {
    return;
  }
  const result = spawnSync("bash", ["-n", toBashPath(file)], { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    failures.push(`${label} bash -n failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
}

function toBashPath(file) {
  const resolved = path.resolve(file);
  const relative = path.relative(root, resolved);
  if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }
  if (relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll("\\", "/");
  }
  if (process.platform !== "win32") {
    return resolved;
  }
  const normalized = resolved.replaceAll("\\", "/");
  const drivePath = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  if (drivePath) {
    return `/mnt/${drivePath[1].toLowerCase()}/${drivePath[2]}`;
  }
  return normalized;
}

function assertMirrorIfPresent() {
  if (mirrorFile === undefined || !existsSync(mirrorFile)) {
    return;
  }
  const guide = readFileSync(path.join(root, productionGuidePath));
  const mirror = readFileSync(mirrorFile);
  if (!guide.equals(mirror)) {
    failures.push("operator mirror PRODUCTION.md SHA-256 does not match canonical guide");
    failures.push(`canonical_sha256=${sha256(guide)}`);
    failures.push(`mirror_sha256=${sha256(mirror)}`);
  }
}

function assertHandoffIfPresent() {
  if (handoffDir === undefined || !existsSync(handoffDir)) {
    return;
  }
  const collector = path.join(handoffDir, "collect-production-operational-evidence.sh");
  if (!existsSync(collector) || !statSync(collector).isFile()) {
    failures.push("handoff collector missing");
    return;
  }
  assertNoCarriageReturn(collector, "generated handoff collector");
  assertBashSyntaxIfAvailable(collector, "generated handoff collector");
}

function git(gitArgs, options = {}) {
  const result = spawnSync("git", gitArgs, {
    cwd: root,
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
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    parsed[key] = next === undefined || next.startsWith("--") ? "true" : next;
    if (parsed[key] !== "true") {
      index += 1;
    }
  }
  return parsed;
}
