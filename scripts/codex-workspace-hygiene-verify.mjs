import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const policyPath = "CODEX_WORKSPACE_POLICY.md";
const workplaceRoot = "E:\\Codex\\rss-habersoft-com\\workplace\\";
const failures = [];

const allowedActivePathReferences = new Set([
  "CODEX_WORKSPACE_POLICY.md",
  "README.md",
  "PRODUCTION.md",
  "scripts/codex-workspace-hygiene-verify.mjs",
  "scripts/monorepo-topology-verify.mjs",
  "rss-admin-ui/scripts/verify-build.mjs",
  "rss-admin-ui/tests/security-boundary.test.ts",
  "rss-habersoft-com/scripts/docs-verify.mjs",
  "rss-habersoft-com/scripts/test-production-operational-evidence.mjs",
  "rss-habersoft-com/scripts/test-staging-rehearsal.mjs",
  "rss-habersoft-com/deploy/staging/target.example.json"
]);
const skippedPathPatterns = [
  /(^|\/)package-lock\.json$/u,
  /(^|\/)node_modules\//u,
  /(^|\/)dist\//u,
  /(^|\/)build\//u,
  /(^|\/)coverage\//u
];
const riskyLocationPattern = /(?:C:\\|C:\/|Desktop)/iu;
const activeTemporaryInstructionPattern =
  /\b(?:Codex|temporary|temp|workspace|worktree|clone|checkout|test folder|build output|package output|task cache|cache output|artifact)\b/iu;
const historicalMarkerPattern = /\b(?:historical|legacy|do-not-use|do not use|not an active instruction|forbidden|denylist|reject|must not)\b/iu;

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

assertPolicyDocument();
assertRootNavigation();
assertTrackedInstructions();
assertNoNestedGitOrSubmodule();

if (failures.length > 0) {
  for (const failure of failures) console.error(`codex-workspace-hygiene-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "codex-workspace-hygiene-ok",
      workplace_root: workplaceRoot,
      policy: policyPath,
      c_drive_desktop_active_temp_instructions: "none",
      cleanup_contract: "prefix-validated-task-root-only",
      nested_git: false,
      submodule: false
    },
    null,
    2
  )
);

function assertPolicyDocument() {
  requireTrackedFile(policyPath);
  const policy = readText(policyPath);
  const requiredFragments = [
    "MS-020E_CODEX_WORKSPACE_HYGIENE_ACTIVE",
    workplaceRoot,
    "New Codex temporary workspaces, clones, Git worktrees, test folders, build outputs, package outputs, and task caches",
    "C: drive and Windows Desktop are forbidden",
    "TMP",
    "TEMP",
    "npm_config_cache",
    "normalize(WORKPLACE_ROOT)",
    "normalize(TASK_ROOT)",
    "assert TASK_ROOT starts with WORKPLACE_ROOT + path separator",
    "assert TASK_ROOT != WORKPLACE_ROOT",
    "assert TASK_ROOT is not drive root / user profile / Desktop / repository root",
    "record final branch/SHA/remote refs",
    "remove only TASK_ROOT",
    "verify TASK_ROOT no longer exists",
    "never use wildcard deletes from WORKPLACE_ROOT",
    "never delete outside TASK_ROOT",
    "SUCCESS_WITH_CLEANUP_BLOCKER"
  ];

  for (const fragment of requiredFragments) {
    if (!policy.includes(fragment)) failures.push(`policy missing required fragment: ${fragment}`);
  }
}

function assertRootNavigation() {
  const readme = readText("README.md");
  const production = readText("PRODUCTION.md");
  for (const [relative, text] of [
    ["README.md", readme],
    ["PRODUCTION.md", production]
  ]) {
    if (!text.includes("CODEX_WORKSPACE_POLICY.md")) {
      failures.push(`${relative} must link CODEX_WORKSPACE_POLICY.md`);
    }
  }
  if (!readme.includes(workplaceRoot)) failures.push("README.md must expose the E: Codex workplace root");
}

function assertTrackedInstructions() {
  const files = gitLines(["ls-files"]);
  for (const file of files) {
    if (skippedPathPatterns.some((pattern) => pattern.test(file))) continue;
    if (isBinaryPath(file)) continue;
    const text = readText(file);
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isActiveRiskyInstruction(file, line)) {
        failures.push(`active C:/Desktop temporary workspace instruction in ${file}:${index + 1}`);
      }
    }
  }
}

function assertNoNestedGitOrSubmodule() {
  if (existsSync(path.join(root, ".gitmodules"))) failures.push(".gitmodules is not allowed");
  for (const project of ["rss-habersoft-com", "rss-admin-ui"]) {
    if (existsSync(path.join(root, project, ".git"))) failures.push(`nested Git directory/file is not allowed: ${project}/.git`);
  }
}

function isKnownGuardrailLine(file, line) {
  if (file === "CODEX_WORKSPACE_POLICY.md" || file === "scripts/codex-workspace-hygiene-verify.mjs") return true;
  if (/(?:forbidden|denylist|reject|must not|old absolute workspace|old workspace|private)/iu.test(line)) return true;
  if (/known_hosts_file/iu.test(line)) return true;
  return false;
}

function isActiveRiskyInstruction(file, line) {
  if (!riskyLocationPattern.test(line)) return false;
  if (!activeTemporaryInstructionPattern.test(line)) return false;
  if (allowedActivePathReferences.has(file) && historicalMarkerPattern.test(line)) return false;
  if (allowedActivePathReferences.has(file) && isKnownGuardrailLine(file, line)) return false;
  return true;
}

function runSelfTest() {
  const cases = [
    {
      file: "docs/runbook.md",
      line: "Create the temporary Codex worktree at C:\\Users\\EVO-MRDM\\Desktop\\habersoft-rss-ms-020x",
      expected: true
    },
    {
      file: "README.md",
      line: "C:\\Users\\EVO-MRDM\\Desktop\\habersoft-rss is historical/legacy/do-not-use for new Codex temporary workspaces.",
      expected: false
    },
    {
      file: "CODEX_WORKSPACE_POLICY.md",
      line: "C: drive and Windows Desktop are forbidden for new Codex-created project temporary workspaces.",
      expected: false
    },
    {
      file: "rss-habersoft-com/deploy/staging/target.example.json",
      line: '"known_hosts_file": "C:/secure/known_hosts"',
      expected: false
    },
    {
      file: "docs/notes.md",
      line: "Regular cache-control text without a local path.",
      expected: false
    }
  ];

  for (const testCase of cases) {
    const actual = isActiveRiskyInstruction(testCase.file, testCase.line);
    if (actual !== testCase.expected) {
      throw new Error(`self-test failed for ${testCase.file}: expected ${testCase.expected}, got ${actual}`);
    }
  }
  console.log(JSON.stringify({ status: "codex-workspace-hygiene-self-test-ok", cases: cases.length }, null, 2));
}

function requireTrackedFile(relative) {
  if (!gitLines(["ls-files", "--", relative]).includes(relative)) {
    failures.push(`required tracked file missing: ${relative}`);
  }
}

function gitLines(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    failures.push(`git ${args.join(" ")} failed`);
    return [];
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean).map(toPosix);
}

function readText(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function isBinaryPath(file) {
  return /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|eot|pdf|zip|tar|gz)$/iu.test(file);
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}
