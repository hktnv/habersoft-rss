import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const backendRoot = process.cwd();
const repoRoot = path.resolve(backendRoot, "..");
const frontendRoot = path.join(repoRoot, "rss-admin-ui");
const failures = [];

const requiredBackendFiles = [
  "PRODUCTION.md",
  "README.md",
  ".docs/repository-conventions.md",
  ".docs/production-acceptance.md",
  ".docs/production-operational-evidence.md",
  ".docs/service-handbook/README.md",
  ".docs/service-handbook/main-servis-kilavuzu.md",
  ".docs/service-handbook/agent-servis-kilavuzu.md",
  ".docs/service-handbook/tenant-servis-kilavuzu.md"
];
const requiredRepoFiles = [
  "README.md",
  "PRODUCTION.md",
  "rss-admin-ui/README.md",
  "rss-admin-ui/PRODUCTION.md",
  "rss-admin-ui/.docs/api-auth-contract.md"
];

for (const file of requiredBackendFiles) requireFile(path.join(backendRoot, file), file);
for (const file of requiredRepoFiles) requireFile(path.join(repoRoot, file), file);

const markdownFiles = [
  path.join(repoRoot, "README.md"),
  path.join(repoRoot, "PRODUCTION.md"),
  path.join(frontendRoot, "README.md"),
  path.join(frontendRoot, "PRODUCTION.md"),
  ...walkMarkdown(path.join(frontendRoot, ".docs")),
  path.join(backendRoot, "README.md"),
  path.join(backendRoot, "PRODUCTION.md"),
  ...walkMarkdown(path.join(backendRoot, ".docs"))
];

for (const file of markdownFiles) {
  const relative = toRepoRelative(file);
  const text = readFileSync(file, "utf8");
  assertNoForbiddenPath(relative, text);
  assertNoSecretAssignment(relative, text);
  assertMarkdownLinks(relative, file, stripCodeFences(text));
}

assertUniqueBasenames(requiredBackendFiles.filter((file) => file.includes("service-handbook/")));
assertDocsOwnership();
assertBackendProductionGuide();
assertFrontendProductionGuide();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`docs-verify: ${failure}`);
  }
  process.exit(1);
}

console.log("docs-verify: ok");

function requireFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    failures.push(`required file missing: ${label}`);
  }
}

function walkMarkdown(directory) {
  const stat = statSafe(directory);
  if (!stat?.isDirectory()) return [];
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "coverage") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...walkMarkdown(absolute));
    if (entry.isFile() && entry.name.endsWith(".md")) entries.push(absolute);
  }
  return entries.sort((left, right) => left.localeCompare(right));
}

function statSafe(file) {
  try {
    return statSync(file);
  } catch {
    return undefined;
  }
}

function assertNoForbiddenPath(relative, text) {
  if (/C:\\Users\\EVO-MRDM\\Desktop\\habersoft-auth\\rss-habersoft-com/iu.test(text)) {
    failures.push(`old absolute workspace path in ${relative}`);
    return;
  }
  if (/habersoft-auth[\\/]rss-habersoft-com/iu.test(text)) {
    failures.push(`old workspace segment in ${relative}`);
    return;
  }

  const allowed = text
    .replaceAll("C:\\Users\\EVO-MRDM\\Desktop\\habersoft-rss", "")
    .replaceAll("/opt/habersoft-rss", "")
    .replaceAll("/home/habersoft.com/rss-panel", "")
    .replaceAll("/home/habersoft.com/rss", "");
  const forbidden = [
    /(?:^|[\s`"'(<])([A-Za-z]:[\\/])/u,
    /\/Users\//u,
    /\/home\//u,
    /\/root\//u,
    /\/tmp\//u
  ];
  for (const pattern of forbidden) {
    if (pattern.test(allowed)) {
      failures.push(`forbidden absolute local path in ${relative}`);
      return;
    }
  }
}

function assertNoSecretAssignment(relative, text) {
  const assignmentPattern =
    /(?:^|\n)\s*(POSTGRES_PASSWORD|DATABASE_URL|TENANT_RATE_LIMIT_KEY_SECRET|AGENT_KEY|JWT|TOKEN|PRIVATE_KEY)\s*=\s*([^\s`'"]+)/giu;
  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    const value = match[2];
    if (isAllowedPlaceholder(value)) continue;
    failures.push(`secret-shaped assignment in ${relative}: ${match[1]}`);
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(text)) {
    failures.push(`private key material marker in ${relative}`);
  }
}

function isAllowedPlaceholder(value) {
  return /^(<[^>]+>|CHANGE_ME|replace_with|redacted|\[REDACTED\]|main_service_local_password|postgresql:\/\/main_service:main_service_local_password@postgres)/iu.test(value);
}

function assertMarkdownLinks(relative, file, text) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const target = normalizeMarkdownTarget(match[1]);
    if (target === "" || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    const targetWithoutAnchor = target.split("#", 1)[0];
    if (targetWithoutAnchor === "") continue;
    if (/^(\.\.\/)+\.md\//u.test(targetWithoutAnchor) || /^\.md\//u.test(targetWithoutAnchor)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(targetWithoutAnchor));
    if (!existsSync(resolved)) failures.push(`broken markdown link in ${relative}: ${target}`);
  }
}

function normalizeMarkdownTarget(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed.slice(1, -1).trim();
  const titleSeparator = trimmed.search(/\s+["']/u);
  return titleSeparator === -1 ? trimmed : trimmed.slice(0, titleSeparator);
}

function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/gu, "");
}

function assertUniqueBasenames(files) {
  const seen = new Set();
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    if (seen.has(name)) failures.push(`duplicate handbook filename: ${name}`);
    seen.add(name);
  }
}

function assertDocsOwnership() {
  const rootGuide = readFileSync(path.join(repoRoot, "PRODUCTION.md"), "utf8");
  const rootReadme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
  for (const text of [rootGuide, rootReadme]) {
    if (!text.includes("POLYREPO_STYLE_SINGLE_GIT_MONOREPO")) {
      failures.push("root docs missing topology classification");
    }
    if (!text.includes("rss-habersoft-com") || !text.includes("rss-admin-ui")) {
      failures.push("root docs missing project links");
    }
  }
  if (/byte-identical mirror|operator mirror PRODUCTION\.md SHA-256/iu.test(rootGuide)) {
    failures.push("root guide still claims retired mirror contract");
  }
}

function assertBackendProductionGuide() {
  const text = readFileSync(path.join(backendRoot, "PRODUCTION.md"), "utf8");
  const requiredPhrases = [
    "MVP",
    "Production Aktif",
    "git pull --ff-only origin main",
    "Codex production SSH kullanmaz",
    ".docs/production-acceptance.md",
    ".docs/production-operational-evidence.md",
    "SUCCESS_GOVERNANCE_ACCEPTED",
    "rss-habersoft-com",
    "PRODUCTION_PATH_MIGRATION_NOT_PERFORMED_IN_MS-020A"
  ];
  for (const phrase of requiredPhrases) {
    if (!text.includes(phrase)) failures.push(`backend PRODUCTION.md missing required phrase: ${phrase}`);
  }
  assertShellSnippetPolicy(text, "backend PRODUCTION.md");
}

function assertFrontendProductionGuide() {
  const text = readFileSync(path.join(frontendRoot, "PRODUCTION.md"), "utf8");
  const requiredPhrases = [
    "FOUNDATION_ONLY",
    "NOT_DEPLOYED",
    "rss-admin-ui",
    "AGENT_KEY",
    "no production deployment"
  ];
  for (const phrase of requiredPhrases) {
    if (!text.includes(phrase)) failures.push(`frontend PRODUCTION.md missing required phrase: ${phrase}`);
  }
}

function assertShellSnippetPolicy(text, label) {
  const shellBlocks = [...text.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1]);
  for (const [index, block] of shellBlocks.entries()) {
    if (/\b(scp|rsync|sftp)\b/iu.test(block)) failures.push(`${label} shell block ${index + 1} contains source upload command`);
    if (/docker\s+compose[\s\S]*\sdown\s+-v\b/iu.test(block)) failures.push(`${label} shell block ${index + 1} contains destructive volume removal`);
    if (/docker\s+compose[\s\S]*--build\b/iu.test(block)) failures.push(`${label} shell block ${index + 1} uses compose --build`);
    if (/:latest\b/iu.test(block)) failures.push(`${label} shell block ${index + 1} uses mutable latest image`);
    if (/git\s+pull(?!\s+--ff-only)/iu.test(block)) failures.push(`${label} shell block ${index + 1} uses git pull without --ff-only`);
  }
}

function toRepoRelative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}
