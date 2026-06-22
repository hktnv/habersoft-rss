import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredHandbookFiles = [
  ".docs/service-handbook/README.md",
  ".docs/service-handbook/main-servis-kilavuzu.md",
  ".docs/service-handbook/agent-servis-kilavuzu.md",
  ".docs/service-handbook/tenant-servis-kilavuzu.md"
];

const failures = [];

for (const file of requiredHandbookFiles) {
  requireFile(file);
}

const markdownFiles = ["README.md", ...walkMarkdown(path.join(root, ".docs"))];

for (const file of markdownFiles) {
  const relative = toRepoRelative(file);
  const text = readFileSync(file, "utf8");
  assertNoLocalAbsolutePath(relative, text);
  assertNoSecretAssignment(relative, text);
  assertMarkdownLinks(relative, file, stripCodeFences(text));
}

assertUniqueBasenames(requiredHandbookFiles);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`docs-verify: ${failure}`);
  }
  process.exit(1);
}

console.log("docs-verify: ok");

function requireFile(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    failures.push(`required file missing: ${relative}`);
  }
}

function walkMarkdown(directory) {
  const entries = [];
  for (const entry of statSafe(directory)?.isDirectory() ? readdirSync(directory, { withFileTypes: true }) : []) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkMarkdown(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      entries.push(absolute);
    }
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

function assertNoLocalAbsolutePath(relative, text) {
  const forbidden = [
    /(?:^|[\s`"'(<])([A-Za-z]:[\\/])/u,
    /\/Users\//u,
    /\/home\//u,
    /\/root\//u,
    /\/tmp\//u,
    /Desktop[\\/]habersoft/u
  ];

  for (const pattern of forbidden) {
    if (pattern.test(text)) {
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
    if (isAllowedPlaceholder(value)) {
      continue;
    }
    failures.push(`secret-shaped assignment in ${relative}: ${match[1]}`);
  }

  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(text)) {
    failures.push(`private key material marker in ${relative}`);
  }
}

function isAllowedPlaceholder(value) {
  return /^(<[^>]+>|CHANGE_ME|replace_with|redacted|\[REDACTED\])/iu.test(value);
}

function assertMarkdownLinks(relative, file, text) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const target = normalizeMarkdownTarget(match[1]);
    if (
      target === "" ||
      target.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(target)
    ) {
      continue;
    }

    const targetWithoutAnchor = target.split("#", 1)[0];
    if (targetWithoutAnchor === "") {
      continue;
    }

    const resolved = path.resolve(path.dirname(file), decodeURIComponent(targetWithoutAnchor));
    if (!existsSync(resolved)) {
      failures.push(`broken markdown link in ${relative}: ${target}`);
    }
  }
}

function normalizeMarkdownTarget(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }

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
    if (seen.has(name)) {
      failures.push(`duplicate handbook filename: ${name}`);
    }
    seen.add(name);
  }
}

function toRepoRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}
