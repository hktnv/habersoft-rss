import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { EXPECTED_MIGRATIONS, EXPECTED_PUBLIC_ROUTES, EXPECTED_SERVICES, RELEASE_IDENTITY } from "../release-identity.mjs";

export const REHEARSAL_RECEIPT_SCHEMA_VERSION = 1;
export const REHEARSAL_PROJECT_PREFIX = "main-service-ms017b2";
export const TENANT_AUTH_REHEARSAL_MODE = "external-https-jwks-readiness-only";
export const SYNTHETIC_SENTINEL_AGENT_ID = "default";
export const SYNTHETIC_SENTINEL_STATUS = "ok";

export function createProjectName(seed) {
  const suffix = crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
  return `${REHEARSAL_PROJECT_PREFIX}-${suffix}`;
}

export function assertExternalOutputRoot(outputRoot, repoRoot = process.cwd()) {
  if (outputRoot === undefined) {
    throw new Error("output-root is required");
  }
  const resolved = path.resolve(outputRoot);
  const relative = path.relative(repoRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("output-root must be outside the repository");
  }
  if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
    throw new Error("output-root must be a directory");
  }
  return resolved;
}

export function assertSafeProjectName(projectName) {
  if (!new RegExp(`^${REHEARSAL_PROJECT_PREFIX}-[a-f0-9]{12}$`, "u").test(projectName)) {
    throw new Error("project name is not scoped to MS-017B2");
  }
}

export function assertSafeTeardownScope(projectName) {
  assertSafeProjectName(projectName);
  if (projectName === "main-service" || projectName === "main-service-production") {
    throw new Error("refusing to teardown non-rehearsal project");
  }
  return true;
}

export async function findFreeLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => {
        if (port === undefined || port < 1024 || port === 80 || port === 443) {
          reject(new Error("could not allocate safe loopback port"));
        } else {
          resolve(port);
        }
      });
    });
  });
}

export function buildRehearsalEnv({ imageId, apiPort, projectName, secrets }) {
  const postgresUser = "main_service_rehearsal";
  const postgresDb = "main_service_rehearsal";
  return {
    MAIN_SERVICE_IMAGE: imageId,
    LOG_LEVEL: "info",
    API_HOST_PORT: String(apiPort),
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: secrets.postgresPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgresql://${postgresUser}:${encodeURIComponent(secrets.postgresPassword)}@postgres:5432/${postgresDb}?schema=public`,
    REDIS_URL: "redis://redis:6379/0",
    TENANT_AUTH_JWKS_URL: "https://www.googleapis.com/oauth2/v3/certs",
    TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
    TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
    TENANT_RATE_LIMIT_REDIS_PREFIX: `tenant_rate_limit:rehearsal:${projectName.replaceAll("-", "_")}`,
    TENANT_RATE_LIMIT_KEY_SECRET: secrets.rateLimitSecret,
    AGENT_KEY: secrets.agentKey,
    CHECKED_AT_MAX_FUTURE_SKEW_SECONDS: "60",
    CHECKED_AT_MAX_AGE_SECONDS: "900",
    ENTRY_RETENTION_DAYS: "30",
    ENTRY_MAX_PER_FEED: "10000",
    ENTRY_DETAIL_RETENTION_DAYS: "7",
    ENTRY_DETAIL_MAX_PER_FEED: "2000",
    BULLMQ_PREFIX: `main-service-rehearsal-${projectName.slice(-12)}`,
    MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS: "604800",
    MAINTENANCE_COMPLETED_JOB_MAX_COUNT: "1000",
    MAINTENANCE_FAILED_JOB_RETENTION_SECONDS: "2592000",
    MAINTENANCE_FAILED_JOB_MAX_COUNT: "5000"
  };
}

export function formatEnv(env) {
  return `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function generateRehearsalSecrets() {
  return {
    postgresPassword: randomSecret(36),
    rateLimitSecret: randomSecret(48),
    agentKey: randomSecret(48)
  };
}

export function compareLocalRehearsalPackagePair(previousManifest, candidateManifest, extra = {}) {
  const failures = [];
  const same = (field) => {
    if (JSON.stringify(previousManifest[field]) !== JSON.stringify(candidateManifest[field])) {
      failures.push(`${field} mismatch`);
    }
  };

  same("version");
  same("master_release");
  same("master_sha256");
  same("master_active_markdown_count");
  same("migrations");
  same("public_routes");
  same("services");

  if (previousManifest.source_commit === candidateManifest.source_commit) {
    failures.push("source commit must differ");
  }
  if (previousManifest.image?.included !== true || candidateManifest.image?.included !== true) {
    failures.push("both packages must include image artifacts");
  }
  if (previousManifest.image?.id === candidateManifest.image?.id) {
    failures.push("image ids must differ");
  }
  if (extra.previousSchemaSha256 !== undefined && extra.previousSchemaSha256 !== extra.candidateSchemaSha256) {
    failures.push("prisma schema hash mismatch");
  }
  if (extra.previousComposeSha256 !== undefined && extra.previousComposeSha256 !== extra.candidateComposeSha256) {
    failures.push("production compose hash mismatch");
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  return {
    same_application_version: true,
    source_commit_different: true,
    master_unchanged: true,
    schema_prisma_unchanged: true,
    migrations_unchanged: true,
    public_routes_unchanged: true,
    production_compose_topology_unchanged: true,
    image_artifacts_independent: true,
    immutable_image_source_rollback_compatible: true
  };
}

export function createRehearsalReceipt(fields) {
  return {
    schema_version: REHEARSAL_RECEIPT_SCHEMA_VERSION,
    rehearsal_type: "local-isolated-staging-rollback-dry-run",
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    ...fields,
    remote_staging_contact_performed: false,
    remote_staging_deployment_performed: false,
    production_deployment_performed: false,
    artifact_publication_performed: false,
    external_registry_publish: false,
    git_tag_created: false,
    github_release_created: false,
    dns_changed: false,
    tls_changed: false,
    cyberpanel_changed: false
  };
}

export function loadRehearsalReceipt(file) {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"));
}

export function validateRehearsalReceipt(receipt) {
  const failures = [];
  const assert = (condition, message) => {
    if (!condition) {
      failures.push(message);
    }
  };
  const required = [
    "schema_version",
    "rehearsal_type",
    "application_version",
    "previous_source_commit",
    "candidate_source_commit",
    "previous_package_sha256",
    "candidate_package_sha256",
    "previous_image_id",
    "candidate_image_id",
    "master_release",
    "master_hash",
    "master_count",
    "migration_inventory",
    "tenant_auth_rehearsal_mode",
    "project_name",
    "service_inventory",
    "candidate_deploy_verified",
    "api_ready_verified",
    "worker_health_verified",
    "sentinel_verified",
    "backup_sha256",
    "restore_verified",
    "rollback_verified",
    "roll_forward_verified",
    "scheduler_verified",
    "teardown_verified",
    "remote_staging_contact_performed",
    "remote_staging_deployment_performed",
    "production_deployment_performed",
    "artifact_publication_performed",
    "external_registry_publish",
    "git_tag_created",
    "github_release_created",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed",
    "started_at",
    "finished_at"
  ];

  for (const field of required) {
    assert(Object.hasOwn(receipt, field), `receipt missing ${field}`);
  }
  assert(receipt.schema_version === REHEARSAL_RECEIPT_SCHEMA_VERSION, "schema_version mismatch");
  assert(receipt.rehearsal_type === "local-isolated-staging-rollback-dry-run", "rehearsal type mismatch");
  assert(receipt.application_version === RELEASE_IDENTITY.version, "application version mismatch");
  assert(receipt.master_release === RELEASE_IDENTITY.masterRelease, "master release mismatch");
  assert(receipt.master_hash === RELEASE_IDENTITY.masterSha256, "master hash mismatch");
  assert(receipt.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, "master count mismatch");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.previous_source_commit)), "previous source commit invalid");
  assert(/^[a-f0-9]{40}$/u.test(String(receipt.candidate_source_commit)), "candidate source commit invalid");
  assert(receipt.previous_source_commit !== receipt.candidate_source_commit, "source commits must differ");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.previous_package_sha256)), "previous package sha invalid");
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.candidate_package_sha256)), "candidate package sha invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.previous_image_id)), "previous image id invalid");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(receipt.candidate_image_id)), "candidate image id invalid");
  assert(receipt.previous_image_id !== receipt.candidate_image_id, "image ids must differ");
  assert(JSON.stringify(receipt.migration_inventory) === JSON.stringify(EXPECTED_MIGRATIONS), "migration inventory mismatch");
  assert(JSON.stringify(receipt.service_inventory) === JSON.stringify(EXPECTED_SERVICES), "service inventory mismatch");
  assert(receipt.tenant_auth_rehearsal_mode === TENANT_AUTH_REHEARSAL_MODE, "tenant auth mode mismatch");
  assertSafeProjectName(String(receipt.project_name ?? ""));

  for (const field of [
    "candidate_deploy_verified",
    "api_ready_verified",
    "worker_health_verified",
    "sentinel_verified",
    "restore_verified",
    "rollback_verified",
    "roll_forward_verified",
    "scheduler_verified",
    "teardown_verified"
  ]) {
    assert(receipt[field] === true, `${field} must be true`);
  }
  for (const field of [
    "remote_staging_contact_performed",
    "remote_staging_deployment_performed",
    "production_deployment_performed",
    "artifact_publication_performed",
    "external_registry_publish",
    "git_tag_created",
    "github_release_created",
    "dns_changed",
    "tls_changed",
    "cyberpanel_changed"
  ]) {
    assert(receipt[field] === false, `${field} must be false`);
  }
  assert(/^[a-f0-9]{64}$/u.test(String(receipt.backup_sha256)), "backup checksum invalid");
  assertDateOrder(receipt.started_at, receipt.finished_at, assert);
  assertNoForbiddenData(receipt, assert);

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  return true;
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function directoryFileSha256(directory, relativePath) {
  return sha256File(path.join(directory, relativePath));
}

export function packageSha256(packageDir) {
  return sha256File(path.join(packageDir, "checksums.sha256"));
}

export function collectPackageFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectPackageFiles(fullPath);
    }
    return entry.isFile() ? [fullPath] : [];
  });
}

function randomSecret(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function assertDateOrder(startedAt, finishedAt, assert) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  assert(Number.isFinite(start), "started_at must be ISO timestamp");
  assert(Number.isFinite(finish), "finished_at must be ISO timestamp");
  assert(start <= finish, "started_at must be before finished_at");
}

function assertNoForbiddenData(value, assert, pathPrefix = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenData(item, assert, `${pathPrefix}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    const text = String(value ?? "");
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|Bearer [A-Za-z0-9._-]+|postgres(?:ql)?:\/\/[^\s]+|AKIA[0-9A-Z]{16}/u.test(text), `secret-like receipt value at ${pathPrefix}`);
    assert(!/[A-Za-z]:\\|\/tmp\/|\/var\/|\/home\//u.test(text), `path-like receipt value at ${pathPrefix}`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const fullPath = pathPrefix === "" ? key : `${pathPrefix}.${key}`;
    assert(!/(password|secret|token|credential|private|database_url|agent_key|jwt|raw|path|host|ip|url)/iu.test(key), `forbidden receipt field ${fullPath}`);
    assertNoForbiddenData(nested, assert, fullPath);
  }
}
