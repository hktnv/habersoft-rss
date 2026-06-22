import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const productionGuide = "PRODUCTION.md";
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
requireFile(productionGuide);

const markdownFiles = [productionGuide, "README.md", ...walkMarkdown(path.join(root, ".docs"))];

for (const file of markdownFiles) {
  const relative = toRepoRelative(file);
  const text = readFileSync(file, "utf8");
  assertNoLocalAbsolutePath(relative, text);
  assertNoSecretAssignment(relative, text);
  assertMarkdownLinks(relative, file, stripCodeFences(text));
}

assertUniqueBasenames(requiredHandbookFiles);
assertProductionGuide();
assertOperatorMirrorIfPresent();

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
  const normalized = relative.replaceAll("\\", "/");
  const inspectedText =
    normalized === productionGuide
      ? text
          .replaceAll("/opt/habersoft-rss", "")
          .replaceAll("/home/habersoft.com/rss-panel", "")
          .replaceAll("/home/habersoft.com/rss", "")
      : text;
  const forbidden = [
    /(?:^|[\s`"'(<])([A-Za-z]:[\\/])/u,
    /\/Users\//u,
    /\/home\//u,
    /\/root\//u,
    /\/tmp\//u,
    /Desktop[\\/]habersoft/u
  ];

  for (const pattern of forbidden) {
    if (pattern.test(inspectedText)) {
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

function assertProductionGuide() {
  const guideFile = path.join(root, productionGuide);
  const text = readFileSync(guideFile, "utf8");
  const stripped = stripCodeFences(text);
  const requiredSections = [
    "## 1. Belgenin amaci ve otoritesi",
    "## 2. Mimariye genel bakis",
    "## 3. Ayni sunucudaki Habersoft servisleri ve port matrisi",
    "## 4. Repository ve sunucu dizin yapisi",
    "## 5. Degismez Git tabanli deployment kurali",
    "## 6. Ilk kurulum",
    "## 7. Guncelleme turune gore deployment akisilari",
    "## 8. Backend build ve immutable image kimligi",
    "## 9. Environment dosyasi",
    "## 10. Docker Compose servisleri ve baslangic sirasi",
    "## 11. Migration",
    "## 12. OpenLiteSpeed reverse proxy ve bos docRoot modeli",
    "## 13. Saglik kontrolu",
    "## 14. Log ve servis yonetimi",
    "## 15. Backup ve restore",
    "## 16. Rollback",
    "## 17. Sorun giderme",
    "## 18. Guvenlik ve yasak islemler",
    "## 19. Operator production kabul kontrol listesi",
    "## 20. Gelecek backend/frontend monorepo gecisi",
    "## 21. rss-panel.habersoft.com aktivasyon onkosullari",
    "## 22. Ilgili ayrintili belgeler"
  ];

  for (const heading of requiredSections) {
    if (!text.includes(heading)) {
      failures.push(`PRODUCTION.md missing required heading: ${heading}`);
    }
  }

  const requiredPhrases = [
    "git pull --ff-only origin main",
    "Kaynak kodu sunucuya scp, rsync, SFTP, ZIP, panel upload veya kopyala-yapistir ile tasinmaz.",
    "server-local Docker build",
    "Codex production SSH kullanmaz",
    "rss-panel.habersoft.com` planned/inactive",
    "backend-only repository layout",
    "habersoft-rss/backend",
    "habersoft-rss/frontend",
    "API_HOST_PORT=3200",
    "MAIN_SERVICE_IMAGE` absent"
  ];

  for (const phrase of requiredPhrases) {
    if (!text.includes(phrase)) {
      failures.push(`PRODUCTION.md missing required contract phrase: ${phrase}`);
    }
  }

  const matrixRows = [
    ["auth.habersoft.com", "127.0.0.1:3100", "mevcut"],
    ["auth-panel.habersoft.com", "127.0.0.1:8080", "mevcut"],
    ["rss.habersoft.com", "127.0.0.1:3200", "backend rollout target"],
    ["rss-panel.habersoft.com", "127.0.0.1:8081", "planned/inactive"]
  ];
  for (const row of matrixRows) {
    if (!row.every((part) => text.includes(part))) {
      failures.push(`PRODUCTION.md missing or misclassified service matrix row: ${row.join(" / ")}`);
    }
  }

  const checklistFields = [
    "deployment UTC date:",
    "Git commit:",
    "image ID:",
    "migration status:",
    "API live status:",
    "API ready status:",
    "worker health status:",
    "OpenLiteSpeed vhost status:",
    "TLS status:",
    "public HTTPS status:",
    "backup SHA-256:",
    "rollback image ID:",
    "operator name/role:",
    "notes:"
  ];
  for (const field of checklistFields) {
    if (!text.includes(field)) {
      failures.push(`PRODUCTION.md checklist missing field: ${field}`);
    }
  }

  if (/rss-panel\.habersoft\.com[` ]+.*active/iu.test(stripped) && !/planned\/inactive/iu.test(text)) {
    failures.push("PRODUCTION.md may claim rss-panel active");
  }

  assertShellSnippetPolicy(text);
}

function assertShellSnippetPolicy(text) {
  const shellBlocks = [...text.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1]);
  for (const [index, block] of shellBlocks.entries()) {
    if (/\b(scp|rsync|sftp)\b/iu.test(block)) {
      failures.push(`PRODUCTION.md shell block ${index + 1} contains source upload command`);
    }
    if (/docker\s+compose[\s\S]*\sdown\s+-v\b/iu.test(block)) {
      failures.push(`PRODUCTION.md shell block ${index + 1} contains destructive volume removal`);
    }
    if (/docker\s+compose[\s\S]*--build\b/iu.test(block)) {
      failures.push(`PRODUCTION.md shell block ${index + 1} uses compose --build`);
    }
    if (/:latest\b/iu.test(block)) {
      failures.push(`PRODUCTION.md shell block ${index + 1} uses mutable latest image`);
    }
    if (/git\s+pull(?!\s+--ff-only)/iu.test(block)) {
      failures.push(`PRODUCTION.md shell block ${index + 1} uses git pull without --ff-only`);
    }
  }
}

function assertOperatorMirrorIfPresent() {
  const mirrorFile = process.env.RSS_PRODUCTION_MIRROR_FILE ?? path.resolve(root, "..", "PRODUCTION.md");
  if (!existsSync(mirrorFile)) {
    return;
  }

  const guide = readFileSync(path.join(root, productionGuide));
  const mirror = readFileSync(mirrorFile);
  const guideSha = sha256(guide);
  const mirrorSha = sha256(mirror);
  if (guideSha !== mirrorSha) {
    failures.push("operator mirror PRODUCTION.md SHA-256 does not match canonical guide");
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
