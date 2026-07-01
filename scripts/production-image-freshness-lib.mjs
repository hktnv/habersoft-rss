import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const IMAGE_REVISION_LABEL = "org.opencontainers.image.revision";
export const IMAGE_SOURCE_LABEL = "org.opencontainers.image.source";
export const CANONICAL_IMAGE_SOURCE = "https://github.com/hktnv/habersoft-rss";

const componentLabels = new Map([
  ["backend", "backend"],
  ["frontend", "frontend"]
]);

export function currentGitRevision(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

export function shortRevision(revision) {
  return /^[a-f0-9]{40}$/u.test(revision) ? revision.slice(0, 12) : "unknown";
}

export function localPromotionTag(component, revision) {
  const suffix = shortRevision(revision);
  if (component === "backend") return `habersoft-rss-backend:${suffix}`;
  if (component === "frontend") return `habersoft-rss-frontend:${suffix}`;
  return `habersoft-rss-${component}:${suffix}`;
}

export function inspectImage(image, options = {}) {
  if (typeof image !== "string" || image.trim() === "") {
    return {
      ok: false,
      image: "missing",
      reason: "image_reference_missing",
      id: "unavailable",
      labels: {}
    };
  }

  const result = spawnSync("docker", ["image", "inspect", image], {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 30000
  });

  if (result.status !== 0) {
    return {
      ok: false,
      image,
      reason: "image_not_available",
      id: "unavailable",
      labels: {},
      exit_code: result.status ?? 1
    };
  }

  try {
    const [record] = JSON.parse(result.stdout);
    return {
      ok: true,
      image,
      id: typeof record?.Id === "string" ? record.Id : "unavailable",
      labels: record?.Config?.Labels ?? {}
    };
  } catch {
    return {
      ok: false,
      image,
      reason: "image_inspect_unparseable",
      id: "unavailable",
      labels: {}
    };
  }
}

export function classifyImageFreshness({ component, image, expectedRevision, expectedSource = CANONICAL_IMAGE_SOURCE, inspectResult }) {
  const label = componentLabels.get(component);
  if (label === undefined) throw new Error(`unknown image freshness component: ${component}`);
  const inspected = inspectResult ?? inspectImage(image);
  const labels = inspected.labels ?? {};
  const revision = labels[IMAGE_REVISION_LABEL];
  const source = labels[IMAGE_SOURCE_LABEL];

  if (!inspected.ok) {
    return staleResult(label, inspected.image ?? image ?? "missing", inspected.id, inspected.reason ?? "image_not_available", revision, source);
  }
  if (revision !== expectedRevision) {
    return staleResult(label, inspected.image ?? image, inspected.id, revision === undefined ? "image_revision_label_missing" : "image_revision_mismatch", revision, source);
  }
  if (source !== expectedSource) {
    return staleResult(label, inspected.image ?? image, inspected.id, source === undefined ? "image_source_label_missing" : "image_source_mismatch", revision, source);
  }

  return {
    status: `${label}_image_current`,
    classification: `${label}_image_current`,
    fresh: true,
    image: inspected.image ?? image,
    image_id: inspected.id ?? "unavailable",
    expected_revision: expectedRevision,
    actual_revision: revision,
    expected_source: expectedSource,
    actual_source: source,
    output: "redacted"
  };
}

export function buildImage({ component, cwd, dockerfile, context, tag, revision, source = CANONICAL_IMAGE_SOURCE, timeoutMs = 900000 }) {
  const args = dockerBuildArgs({ dockerfile, context, tag, revision, source });
  const result = spawnSync("docker", args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs
  });

  if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
  if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);
  if (result.error !== undefined) throw result.error;

  return {
    ok: result.status === 0,
    component,
    tag,
    exit_code: result.status ?? 1,
    command_preview: ["docker", ...args].join(" ")
  };
}

export function dockerBuildArgs({ dockerfile, context, tag, revision, source = CANONICAL_IMAGE_SOURCE }) {
  return [
    "build",
    "-f",
    dockerfile,
    "-t",
    tag,
    "--build-arg",
    `HABERSOFT_IMAGE_REVISION=${revision}`,
    "--build-arg",
    `HABERSOFT_IMAGE_SOURCE=${source}`,
    context
  ];
}

export function parseEnvText(text) {
  const parsed = {};
  for (const rawLine of String(text).split(/\r?\n/u)) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[name] = value;
  }
  return parsed;
}

export function readEnvValue(file, key) {
  if (!existsSync(file)) return undefined;
  return parseEnvText(readFileSync(file, "utf8"))[key];
}

export function setEnvAssignmentText(text, key, value) {
  const lines = String(text).split(/\r?\n/u);
  let replaced = false;
  const next = lines.map((line) => {
    const match = /^(\s*(?:export\s+)?)([A-Z0-9_]+)(\s*=).*/u.exec(line);
    if (match?.[2] !== key) return line;
    replaced = true;
    return `${match[1]}${key}${match[3]}${value}`;
  });
  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }
  return `${next.join("\n").replace(/\n+$/u, "")}\n`;
}

export function writeEnvAssignment(file, key, value) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, setEnvAssignmentText(current, key, value), { encoding: "utf8", mode: 0o600 });
}

export function isImmutableImageReference(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? "")) || /@sha256:[a-f0-9]{64}$/u.test(String(value ?? ""));
}

function staleResult(component, image, imageId, reason, revision, source) {
  return {
    status: `${component}_image_stale`,
    classification: `${component}_image_stale`,
    fresh: false,
    image,
    image_id: imageId ?? "unavailable",
    reason,
    actual_revision: revision ?? "missing",
    actual_source: source ?? "missing",
    output: "redacted"
  };
}
