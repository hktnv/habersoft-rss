import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationBase = process.env.MS020A_MIGRATION_BASE_REF ?? "73e2725a6f1fad024de2cddcae912147f29a65f9";
const backendRoot = "rss-habersoft-com";
const frontendRoot = "rss-admin-ui";
const failures = [];

const requiredRootFiles = [
  "README.md",
  "PRODUCTION.md",
  "CODEX_WORKSPACE_POLICY.md",
  "compose.yaml",
  "scripts/codex-workspace-hygiene-verify.mjs",
  "scripts/monorepo-topology-verify.mjs",
  ".gitattributes",
  ".gitignore"
];
const requiredBackendFiles = [
  "README.md",
  "PRODUCTION.md",
  ".docs/production-acceptance.md",
  ".docs/production-operational-evidence.md",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "compose.yaml",
  "deploy/production/compose.yaml",
  "scripts/docs-verify.mjs",
  "src/main-api.ts",
  "prisma/schema.prisma"
];
const requiredFrontendFiles = [
  "README.md",
  "PRODUCTION.md",
  ".docs/api-auth-contract.md",
  ".docs/admin-auth-session-boundary.md",
  ".docs/admin-session-sentinel.md",
  "package.json",
  "package-lock.json",
  "Dockerfile",
  ".dockerignore",
  "deploy/production/compose.yaml",
  ".docs/read-only-status-dashboard.md",
  ".docs/same-origin-health-transport.md",
  ".docs/production-activation-readiness.md",
  ".docs/production-activation-package.md",
  ".docs/admin-auth-production-operator-handoff.md",
  "src/App.tsx",
  "src/auth/adminSessionBoundary.ts",
  "src/auth/adminSessionClient.ts",
  "src/auth/ProtectedAdminShell.tsx",
  "src/auth/useAdminSessionStatus.ts",
  "src/status/healthClient.ts",
  "src/status/StatusDashboard.tsx",
  "scripts/auth-boundary-verify.mjs",
  "scripts/auth-session-sentinel-harness.mjs",
  "scripts/auth-proxy-harness.mjs",
  "scripts/production-readiness-verify.mjs",
  "scripts/production-activation-package-verify.mjs",
  "scripts/production-mode-rc.mjs",
  "tests/app-shell.test.tsx",
  "tests/admin-session-boundary.test.ts",
  "tests/admin-session-client.test.ts",
  "tests/protected-admin-shell.test.tsx",
  "tests/production-readiness-doc.test.ts"
];
const protectedBackendPaths = [
  "src",
  "prisma/schema.prisma",
  "prisma/migrations",
  "Dockerfile",
  "deploy/production/compose.yaml",
  "deploy/production/production.env.template",
  "package.json",
  "package-lock.json"
];
const allowedBackendAdminAuthDelta = new Set([
  "package.json",
  "src/api.module.ts",
  "src/bootstrap/api-entrypoint.ts",
  "src/configuration/runtime-config.ts"
]);

assertDirectory(backendRoot);
assertDirectory(frontendRoot);
for (const file of requiredRootFiles) requireFile(file);
for (const file of requiredBackendFiles) requireFile(path.join(backendRoot, file));
for (const file of requiredFrontendFiles) requireFile(path.join(frontendRoot, file));
assertNoNestedGit();
assertIndependentLocks();
assertRootDocs();
assertGitTrackedShape();
assertNoStaleActivePaths();
assertProtectedBackendContent();
assertMigrationInventory();
assertDockerContexts();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`monorepo-topology-verify: ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: "monorepo-topology-ok",
  topology: "POLYREPO_STYLE_SINGLE_GIT_MONOREPO",
  migration_base: migrationBase,
  project_roots: [backendRoot, frontendRoot],
  backend_protected_content: "byte-identical-except-ms022a-admin-auth-and-ms022b-package-delta",
  nested_git: false
}, null, 2));

function assertDirectory(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    failures.push(`required directory missing: ${relative}`);
  }
}

function requireFile(relative) {
  const normalized = toPosix(relative);
  const absolute = path.join(root, normalized);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    failures.push(`required file missing: ${normalized}`);
  }
}

function assertNoNestedGit() {
  for (const project of [backendRoot, frontendRoot]) {
    const nested = path.join(root, project, ".git");
    if (existsSync(nested)) {
      failures.push(`nested Git directory/file is not allowed: ${project}/.git`);
    }
  }
}

function assertIndependentLocks() {
  const backendPackage = readJson(path.join(root, backendRoot, "package.json"));
  const frontendPackage = readJson(path.join(root, frontendRoot, "package.json"));
  const backendLock = readJson(path.join(root, backendRoot, "package-lock.json"));
  const frontendLock = readJson(path.join(root, frontendRoot, "package-lock.json"));

  if (backendPackage?.name !== "main-service") failures.push("backend package name changed");
  if (backendPackage?.version !== "0.1.0-ms-017") failures.push("backend version changed");
  if (frontendPackage?.name !== "rss-admin-ui") failures.push("frontend package name must be rss-admin-ui");
  if (backendLock?.packages?.[""]?.name !== "main-service") failures.push("backend lock root package mismatch");
  if (frontendLock?.packages?.[""]?.name !== "rss-admin-ui") failures.push("frontend lock root package mismatch");
}

function assertRootDocs() {
  const rootReadme = readText("README.md");
  const rootProduction = readText("PRODUCTION.md");
  const backendProduction = readText(path.join(backendRoot, "PRODUCTION.md"));
  const frontendProduction = readText(path.join(frontendRoot, "PRODUCTION.md"));

  for (const text of [rootReadme, rootProduction]) {
    if (!text.includes("POLYREPO_STYLE_SINGLE_GIT_MONOREPO")) {
      failures.push("root docs must state topology classification");
    }
    if (!text.includes("rss-habersoft-com") || !text.includes("rss-admin-ui")) {
      failures.push("root docs must link both project roots");
    }
    if (!text.includes("CODEX_WORKSPACE_POLICY.md")) {
      failures.push("root docs must link Codex workspace policy");
    }
  }
  if (!rootProduction.includes("PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A")) {
    failures.push("root production guide missing path migration status");
  }
  if (!backendProduction.includes("SUCCESS_GOVERNANCE_ACCEPTED")) {
    failures.push("backend production guide lost accepted evidence history");
  }
  if (
    (!frontendProduction.includes("MS-022A_ADMIN_AUTH_FOUNDATION_LOCAL_ONLY") &&
      !frontendProduction.includes("MS-022B_PRODUCTION_ACTIVATION_PACKAGE_READY")) ||
    !frontendProduction.includes("/admin-auth/session") ||
    !frontendProduction.includes("/admin-auth/login") ||
    !frontendProduction.includes("NOT_DEPLOYED")
  ) {
    failures.push("frontend production guide must state MS-022A auth foundation and not deployed");
  }
  if (/byte-identical mirror/iu.test(rootProduction) || /operator mirror PRODUCTION\.md SHA-256/iu.test(rootProduction)) {
    failures.push("root production guide still claims old mirror contract");
  }
}

function assertGitTrackedShape() {
  const files = gitLines(["ls-files"]);
  const rootTrackedProjects = files
    .map((file) => file.split("/", 1)[0])
    .filter((entry) => entry === backendRoot || entry === frontendRoot);
  if (!rootTrackedProjects.includes(backendRoot) || !rootTrackedProjects.includes(frontendRoot)) {
    failures.push("both project roots must have tracked files");
  }
  const forbiddenRootBackendFiles = ["package.json", "package-lock.json", "Dockerfile", "tsconfig.json", "jest.config.js", "eslint.config.js"];
  for (const file of forbiddenRootBackendFiles) {
    if (files.includes(file)) {
      failures.push(`backend-owned file still tracked at root: ${file}`);
    }
  }
}

function assertNoStaleActivePaths() {
  const files = gitLines(["ls-files"]);
  const forbidden = [
    { label: "old absolute workspace", pattern: /C:\\Users\\EVO-MRDM\\Desktop\\habersoft-auth\\rss-habersoft-com/iu },
    { label: "old absolute workspace slash", pattern: /C:\/Users\/EVO-MRDM\/Desktop\/habersoft-auth\/rss-habersoft-com/iu },
    { label: "old nested project path", pattern: /rss-habersoft-com[\\/]main-service/iu },
    { label: "old mirror contract", pattern: /\.\.\/PRODUCTION\.md mirror|\.\.\\PRODUCTION\.md mirror/iu },
    { label: "main-service filesystem root", pattern: /(?:^|[\s`"'(])main-service[\\/]/iu }
  ];

  for (const file of files) {
    if (isBinaryPath(file) || file.endsWith("package-lock.json")) continue;
    const text = readText(file);
    for (const check of forbidden) {
      if (check.pattern.test(text)) {
        failures.push(`stale active path in ${file}: ${check.label}`);
        break;
      }
    }
  }
}

function assertProtectedBackendContent() {
  for (const protectedPath of protectedBackendPaths) {
    const oldFiles = listGitFilesAt(migrationBase, protectedPath);
    if (oldFiles.length === 0) {
      failures.push(`protected baseline path missing at ${migrationBase}: ${protectedPath}`);
      continue;
    }
    for (const oldFile of oldFiles) {
      if (allowedBackendAdminAuthDelta.has(toPosix(oldFile))) {
        continue;
      }
      const newFile = toPosix(path.join(backendRoot, oldFile));
      if (!existsSync(path.join(root, newFile))) {
        failures.push(`protected file missing after move: ${newFile}`);
        continue;
      }
      const oldSha = gitBlobSha(`${migrationBase}:${oldFile}`);
      const newSha = trackedBlobSha(newFile);
      if (oldSha !== newSha) {
        failures.push(`protected file changed: ${oldFile}`);
      }
    }
  }
}

function assertMigrationInventory() {
  const migrations = readdirSync(path.join(root, backendRoot, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expected = ["20260620000000_initial_empty", "20260620001000_canonical_business_schema"];
  if (JSON.stringify(migrations) !== JSON.stringify(expected)) {
    failures.push(`migration inventory mismatch: ${migrations.join(", ")}`);
  }
}

function assertDockerContexts() {
  const rootCompose = readText("compose.yaml");
  if (!rootCompose.includes("context: ./rss-habersoft-com")) {
    failures.push("root compose missing backend build context");
  }
  if (!rootCompose.includes("context: ./rss-admin-ui")) {
    failures.push("root compose missing frontend build context");
  }
  if (/main-service-ms-|habersoft-auth\\rss-habersoft-com|habersoft-auth\/rss-habersoft-com/iu.test(rootCompose)) {
    failures.push("root compose contains old workspace path");
  }
}

function listGitFilesAt(ref, relative) {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", ref, "--", relative], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function gitBlobSha(spec) {
  const result = spawnSync("git", ["show", spec], {
    cwd: root,
    encoding: "buffer",
    shell: false
  });
  if (result.status !== 0) {
    failures.push(`cannot read protected blob: ${spec}`);
    return "";
  }
  return sha256(result.stdout);
}

function trackedBlobSha(relative) {
  const staged = spawnSync("git", ["show", `:${relative}`], {
    cwd: root,
    encoding: "buffer",
    shell: false
  });
  if (staged.status === 0) return sha256(staged.stdout);

  const head = spawnSync("git", ["show", `HEAD:${relative}`], {
    cwd: root,
    encoding: "buffer",
    shell: false
  });
  if (head.status === 0) return sha256(head.stdout);

  failures.push(`cannot read protected tracked blob: ${relative}`);
  return "";
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
  return readFileSync(path.join(root, toPosix(relative)), "utf8");
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    failures.push(`invalid JSON: ${toPosix(path.relative(root, file))}`);
    return undefined;
  }
}

function isBinaryPath(file) {
  return /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|eot|pdf|zip|tar|gz)$/iu.test(file);
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
