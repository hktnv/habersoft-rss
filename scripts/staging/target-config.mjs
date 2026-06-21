import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const productionHosts = new Set(["rss.habersoft.com", "habersoft.com", "www.habersoft.com"]);
const edgeModes = new Set(["loopback-only", "https"]);
const safeBasePrefixes = ["/opt/habersoft/", "/srv/habersoft/", "/var/opt/habersoft/"];
const forbiddenRootDirs = new Set(["/", "/etc", "/var", "/var/lib", "/var/lib/docker", "/home", "/root", "/tmp"]);
const allowedSensitivePathKeys = new Set(["known_hosts_file"]);

export function loadTargetConfig(file) {
  if (file === undefined) {
    throw new Error("target file is required");
  }
  return JSON.parse(stripBom(readFileSync(path.resolve(file), "utf8")));
}

export function validateTargetConfig(target) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };

  assert(target?.environment === "staging", "environment must be staging");
  assert(target?.approved === true, "approved must be true");
  assertNonEmptyString(target?.target_alias, "target_alias", assert);
  assertNonEmptyString(target?.ssh_host, "ssh_host", assert);
  assertNonEmptyString(target?.ssh_user, "ssh_user", assert);
  assertNonEmptyString(target?.known_hosts_file, "known_hosts_file", assert);
  assertNonEmptyString(target?.remote_environment_marker_path, "remote_environment_marker_path", assert);
  assertNonEmptyString(target?.remote_environment_marker_value, "remote_environment_marker_value", assert);
  assertNonEmptyString(target?.remote_base_dir, "remote_base_dir", assert);
  assertNonEmptyString(target?.compose_project_name, "compose_project_name", assert);

  const alias = lower(target?.target_alias);
  const host = lower(target?.ssh_host);
  const project = lower(target?.compose_project_name);
  const base = normalizePosixPath(target?.remote_base_dir ?? "");
  const marker = normalizePosixPath(target?.remote_environment_marker_path ?? "");

  assert(alias.includes("staging"), "target_alias must include staging");
  assert(project.includes("staging"), "compose_project_name must include staging");
  assert(base.includes("staging"), "remote_base_dir must include staging");
  assert(project !== "main-service-production", "compose_project_name must not be production");
  assert(!productionHosts.has(host), "ssh_host must not be a production hostname");
  assert(host !== "localhost" && host !== "127.0.0.1" && host !== "::1", "ssh_host must not be localhost");
  assert(!host.endsWith(".local"), "ssh_host must not be an implicit local target");
  assertInteger(target?.ssh_port, 1, 65535, "ssh_port", assert);
  assertInteger(target?.api_host_port, 1024, 65535, "api_host_port", assert);
  assert(target?.api_host_port !== 80 && target?.api_host_port !== 443, "api_host_port must not be 80 or 443");

  assert(path.isAbsolute(path.resolve(target?.known_hosts_file ?? "")), "known_hosts_file must resolve to an absolute local path");
  assert(existsSync(path.resolve(target?.known_hosts_file ?? "")), "known_hosts_file must be readable");
  assert(isAbsolutePosix(marker), "remote_environment_marker_path must be absolute");
  assert(!containsTraversal(marker), "remote_environment_marker_path must not contain traversal");
  assert(isAbsolutePosix(base), "remote_base_dir must be absolute");
  assert(!containsTraversal(base), "remote_base_dir must not contain traversal");
  assert(!forbiddenRootDirs.has(base), "remote_base_dir must not be a forbidden root directory");
  assert(safeBasePrefixes.some((prefix) => base.startsWith(prefix)), "remote_base_dir must be under an allowed staging prefix");

  assert(edgeModes.has(target?.edge_mode), "edge_mode must be loopback-only or https");
  if (target?.edge_mode === "https") {
    assertNonEmptyString(target?.public_base_url, "public_base_url", assert);
    try {
      const parsed = new URL(target.public_base_url);
      assert(parsed.protocol === "https:", "public_base_url must use HTTPS");
      assert(!productionHosts.has(lower(parsed.hostname)), "public_base_url must not be production");
    } catch {
      failures.push("public_base_url must be a valid HTTPS URL");
    }
  } else {
    assert(target?.public_base_url === null || target?.public_base_url === undefined, "loopback-only target must not set public_base_url");
  }

  for (const issue of findSecretFields(target)) {
    failures.push(issue);
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  return {
    environment: target.environment,
    targetAlias: target.target_alias,
    edgeMode: target.edge_mode,
    composeProjectName: target.compose_project_name,
    remoteBaseDir: base,
    apiHostPort: target.api_host_port
  };
}

export function loadAndValidateTargetConfig(file) {
  const target = loadTargetConfig(file);
  validateTargetConfig(target);
  return target;
}

export function sanitizeTargetForReceipt(target) {
  return {
    target_alias: target.target_alias,
    environment: target.environment,
    edge_mode: target.edge_mode,
    compose_project_name: target.compose_project_name,
    api_host_port: target.api_host_port
  };
}

function assertNonEmptyString(value, name, assert) {
  assert(typeof value === "string" && value.trim() !== "", `${name} must be a non-empty string`);
}

function assertInteger(value, min, max, name, assert) {
  assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer between ${min} and ${max}`);
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function normalizePosixPath(value) {
  return String(value).replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "") || "/";
}

function isAbsolutePosix(value) {
  return String(value).startsWith("/");
}

function containsTraversal(value) {
  return String(value).split("/").includes("..");
}

function findSecretFields(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecretFields(item, `${prefix}[${index}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const fullPath = prefix === "" ? key : `${prefix}.${key}`;
    const keyName = key.toLowerCase();
    const looksSecret = /(password|secret|token|credential|private|database_url|agent_key|rate_limit_key|ssh_key)/u.test(keyName);
    const issues = looksSecret && !allowedSensitivePathKeys.has(keyName) ? [`target config must not contain secret-like field ${fullPath}`] : [];
    return [...issues, ...findSecretFields(nested, fullPath)];
  });
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
