import crypto from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_MIGRATIONS,
  EXPECTED_PUBLIC_ROUTES,
  EXPECTED_SERVICES,
  RELEASE_IDENTITY
} from "./release-identity.mjs";
import { INCOMPLETE_IMAGE_MARKER, REQUIRED_ENV_KEYS } from "./staging/env-inputs.mjs";

export const EXPECTED_BUNDLE_FILES = Object.freeze([
  "checksums.sha256",
  "environment-marker-instructions.md",
  "handoff-manifest.json",
  "host-requirements.json",
  "known-hosts-instructions.md",
  "local-rehearsal-evidence.json",
  "operator-checklist.md",
  "package-handoff-requirements.json",
  "staging-target.template.json",
  "staging.env.template"
]);

const PAYLOAD_FILES = Object.freeze([
  "environment-marker-instructions.md",
  "host-requirements.json",
  "known-hosts-instructions.md",
  "local-rehearsal-evidence.json",
  "operator-checklist.md",
  "package-handoff-requirements.json",
  "staging-target.template.json",
  "staging.env.template"
]);

const CHECKSUM_FILES = Object.freeze([
  "environment-marker-instructions.md",
  "handoff-manifest.json",
  "host-requirements.json",
  "known-hosts-instructions.md",
  "local-rehearsal-evidence.json",
  "operator-checklist.md",
  "package-handoff-requirements.json",
  "staging-target.template.json",
  "staging.env.template"
]);

const SAFETY_FLAG_KEYS = Object.freeze([
  "ssh_contacted",
  "network_contacted",
  "known_hosts_generated",
  "target_approved_generated",
  "secret_generated",
  "remote_marker_created",
  "release_package_generated",
  "deployable_artifact_included",
  "docker_mutation_performed",
  "remote_mutation_performed",
  "staging_deployment_performed",
  "production_deployment_performed",
  "artifact_publication_performed",
  "git_tag_created",
  "github_release_created",
  "dns_changed",
  "tls_changed",
  "cyberpanel_changed"
]);

const OFFICIAL_SOURCE_TOPICS = Object.freeze([
  "OpenSSH known_hosts lookup and ssh-keygen fingerprint inspection",
  "OpenSSH BatchMode, StrictHostKeyChecking and UserKnownHostsFile options",
  "Docker Engine availability and noninteractive Docker CLI access",
  "Docker Compose v2 project, network, port, volume and wait behavior",
  "Docker Compose loopback host port publishing",
  "PostgreSQL pg_dump custom-format backup and pg_restore verification"
]);

const allowedRemoteBasePrefixes = Object.freeze([
  "/opt/habersoft/",
  "/srv/habersoft/",
  "/var/opt/habersoft/"
]);

const forbiddenRemoteBaseDirs = new Set([
  "/",
  "/etc",
  "/var",
  "/var/lib",
  "/var/lib/docker",
  "/home",
  "/root",
  "/tmp"
]);

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = process.cwd();

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main();
}

function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  try {
    switch (command) {
      case "generate":
        generate(args);
        break;
      case "verify":
        verify(args);
        break;
      default:
        fail("usage: staging-operator-handoff <generate|verify>");
    }
  } catch (error) {
    fail(error.message);
  }
}

export function generate(args) {
  const params = normalizeGenerateArgs(args);
  prepareOutputDir(params.outputDir, args.overwrite === "true");
  const generatedAt = new Date().toISOString();

  writeJson(path.join(params.outputDir, "host-requirements.json"), createHostRequirements(params), 0o644);
  writeJson(path.join(params.outputDir, "staging-target.template.json"), createTargetTemplate(params), 0o644);
  writeText(path.join(params.outputDir, "staging.env.template"), createEnvTemplate(params), 0o644);
  writeText(path.join(params.outputDir, "known-hosts-instructions.md"), createKnownHostsInstructions(), 0o644);
  writeText(path.join(params.outputDir, "environment-marker-instructions.md"), createEnvironmentMarkerInstructions(), 0o644);
  writeJson(path.join(params.outputDir, "package-handoff-requirements.json"), createPackageHandoffRequirements(), 0o644);
  writeJson(path.join(params.outputDir, "local-rehearsal-evidence.json"), createLocalRehearsalEvidence(), 0o644);
  writeText(path.join(params.outputDir, "operator-checklist.md"), renderOperatorChecklist(params, generatedAt), 0o644);

  const payloadFiles = collectFileMetadata(params.outputDir, PAYLOAD_FILES);
  writeJson(path.join(params.outputDir, "handoff-manifest.json"), createManifest(params, generatedAt, payloadFiles), 0o644);
  writeChecksums(params.outputDir);

  const result = verifyBundle(params.outputDir);
  console.log(JSON.stringify({
    status: "staging-operator-handoff-generated",
    bundle: params.outputDir,
    verified: result.ok,
    files: EXPECTED_BUNDLE_FILES,
    ssh_contacted: false,
    network_contacted: false,
    remote_mutation_performed: false,
    deployment_performed: false
  }, null, 2));
}

export function verify(args) {
  const bundle = requiredExternalPath(args.bundle, "bundle");
  const result = verifyBundle(bundle);
  console.log(JSON.stringify({
    status: "staging-operator-handoff-verified",
    bundle,
    files: result.files,
    ssh_contacted: false,
    network_contacted: false,
    remote_mutation_performed: false,
    deployment_performed: false
  }, null, 2));
}

export function verifyBundle(bundle) {
  const root = requiredExternalPath(bundle, "bundle");
  assert(existsSync(root) && statSync(root).isDirectory(), "bundle must be an existing directory");
  assertExactBundleFiles(root);
  const checksumMap = verifyChecksums(root);

  const manifest = readJson(path.join(root, "handoff-manifest.json"));
  const hostRequirements = readJson(path.join(root, "host-requirements.json"));
  const targetTemplate = readJson(path.join(root, "staging-target.template.json"));
  const packageRequirements = readJson(path.join(root, "package-handoff-requirements.json"));
  const localEvidence = readJson(path.join(root, "local-rehearsal-evidence.json"));
  const envTemplate = readText(path.join(root, "staging.env.template"));
  const checklist = readText(path.join(root, "operator-checklist.md"));
  const knownHostsInstructions = readText(path.join(root, "known-hosts-instructions.md"));
  const markerInstructions = readText(path.join(root, "environment-marker-instructions.md"));

  validateTrackedSchemas();
  validateManifest(manifest, checksumMap, root);
  validateHostRequirements(hostRequirements, manifest);
  validateTargetTemplate(targetTemplate, hostRequirements, manifest);
  validateEnvTemplate(envTemplate, manifest);
  validatePackageRequirements(packageRequirements);
  validateLocalRehearsalEvidence(localEvidence);
  validateChecklistAndInstructions(checklist, knownHostsInstructions, markerInstructions);
  scanBundleText(root);

  return { ok: true, files: EXPECTED_BUNDLE_FILES };
}

function normalizeGenerateArgs(args) {
  const outputDir = requiredExternalPath(args["output-dir"], "output-dir");
  const platform = args.platform ?? "linux/amd64";
  const edgeMode = args["edge-mode"] ?? "loopback-only";
  const markerPath = normalizePosixPath(requiredString(args["marker-path"], "marker-path"));
  const remoteBaseDir = normalizePosixPath(requiredString(args["remote-base-dir"], "remote-base-dir"));
  const projectName = requiredString(args["project-name"], "project-name");
  const apiPort = parsePort(args["api-port"], "api-port");

  assert(platform === "linux/amd64", "platform must be linux/amd64 for this staging handoff");
  assert(edgeMode === "loopback-only", "edge-mode must be loopback-only for this staging handoff");
  validateMarkerPath(markerPath);
  validateRemoteBaseDir(remoteBaseDir);
  validateProjectName(projectName);

  return { outputDir, platform, edgeMode, markerPath, remoteBaseDir, projectName, apiPort };
}

function prepareOutputDir(outputDir, overwrite) {
  if (existsSync(outputDir)) {
    assert(statSync(outputDir).isDirectory(), "output-dir must be a directory");
    const entries = readdirSync(outputDir, { withFileTypes: true });
    if (entries.length > 0 && !overwrite) {
      throw new Error("output-dir must be empty unless --overwrite true is supplied");
    }
    for (const entry of entries) {
      assert(entry.isFile(), "overwrite only supports existing generated files");
      assert(EXPECTED_BUNDLE_FILES.includes(entry.name), `output-dir contains unexpected file ${entry.name}`);
    }
  }
  mkdirSync(outputDir, { recursive: true });
}

function createHostRequirements(params) {
  return {
    schema_version: 1,
    environment: "staging",
    application: RELEASE_IDENTITY.application,
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    required_platform: params.platform,
    operating_system: "Linux",
    docker_engine_required: true,
    docker_compose_v2_required: true,
    noninteractive_docker_access_required: true,
    ssh_batch_mode_required: true,
    pinned_known_hosts_required: true,
    remote_marker_required: true,
    remote_marker_value: "staging",
    production_compose_service_count: EXPECTED_SERVICES.length,
    compose_services: [...EXPECTED_SERVICES],
    api_binding: params.edgeMode,
    api_host_port: params.apiPort,
    public_database_port_allowed: false,
    public_redis_port_allowed: false,
    public_worker_port_allowed: false,
    persistent_postgresql_volume_required: true,
    persistent_redis_volume_required: true,
    off_host_postgresql_backup_required_before_rollout: true,
    resource_limits: "site-specific-after-benchmark",
    capacity_model: {
      cpu_ram_not_invented: true,
      measurements_required_before_sizing: [
        "active_feed_count",
        "target_poll_interval_seconds",
        "peak_agent_entry_batches_per_minute",
        "peak_tenant_api_requests_per_minute",
        "postgresql_data_growth_per_day",
        "redis_job_and_rate_limit_memory_footprint",
        "backup_window_minutes"
      ],
      formula: {
        feed_poll_budget_per_minute: "active_feed_count * 60 / target_poll_interval_seconds",
        agent_batch_write_budget_per_minute: "peak_agent_entry_batches_per_minute * max_entries_per_batch",
        postgresql_storage_floor: "current_database_size + retained_entry_growth + backup_restore_headroom",
        rollback_window_capacity: "candidate_package_size + previous_package_size + off_host_backup_size + restore_scratch_space"
      },
      single_host_failure_domain: true,
      ha_claimed: false
    },
    filesystem: {
      remote_environment_marker_path: params.markerPath,
      remote_base_dir: params.remoteBaseDir,
      release_layout_required: true,
      operator_owns_directory_creation: true,
      world_writable_paths_allowed: false
    },
    edge_conditions: {
      production_hostname_allowed: false,
      production_ip_allowed: false,
      public_database_or_redis_allowed: false,
      dns_tls_cyberpanel_live_change_performed: false,
      external_registry_publish_performed: false
    },
    remote_preflight_required: true,
    remote_mutation_performed: false,
    remote_deployment_performed: false
  };
}

function createTargetTemplate(params) {
  return {
    environment: "staging",
    approved: false,
    target_alias: "OPERATOR_REPLACE_WITH_STAGING_ALIAS",
    ssh_host: "OPERATOR_REPLACE_WITH_NON_PRODUCTION_STAGING_HOST",
    ssh_port: 22,
    ssh_user: "OPERATOR_REPLACE_WITH_DEPLOY_USER",
    known_hosts_file: "OPERATOR_REPLACE_WITH_EXTERNAL_PINNED_KNOWN_HOSTS_FILE",
    remote_environment_marker_path: params.markerPath,
    remote_environment_marker_value: "staging",
    remote_base_dir: params.remoteBaseDir,
    compose_project_name: params.projectName,
    api_host_port: params.apiPort,
    edge_mode: params.edgeMode,
    public_base_url: null
  };
}

function createEnvTemplate(params) {
  const values = {
    MAIN_SERVICE_IMAGE: INCOMPLETE_IMAGE_MARKER,
    LOG_LEVEL: "info",
    API_HOST_PORT: String(params.apiPort),
    POSTGRES_USER: "main_service_staging",
    POSTGRES_PASSWORD: "<STAGING_POSTGRES_PASSWORD_MINIMUM_32_BYTES>",
    POSTGRES_DB: "main_service_staging",
    DATABASE_URL: "postgresql://main_service_staging:<STAGING_POSTGRES_PASSWORD_URL_ENCODED>@postgres:5432/main_service_staging?schema=public",
    REDIS_URL: "redis://redis:6379/0",
    TENANT_AUTH_JWKS_URL: "<STAGING_HTTPS_JWKS_URL>",
    TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
    TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
    TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:staging",
    TENANT_RATE_LIMIT_KEY_SECRET: "<STAGING_RATE_LIMIT_KEY_SECRET_MINIMUM_32_BYTES>",
    AGENT_KEY: "<STAGING_AGENT_KEY_MINIMUM_32_BYTES>",
    CHECKED_AT_MAX_FUTURE_SKEW_SECONDS: "60",
    CHECKED_AT_MAX_AGE_SECONDS: "900",
    ENTRY_RETENTION_DAYS: "30",
    ENTRY_MAX_PER_FEED: "10000",
    ENTRY_DETAIL_RETENTION_DAYS: "7",
    ENTRY_DETAIL_MAX_PER_FEED: "2000",
    BULLMQ_PREFIX: "main-service-staging",
    MAINTENANCE_COMPLETED_JOB_RETENTION_SECONDS: "604800",
    MAINTENANCE_COMPLETED_JOB_MAX_COUNT: "1000",
    MAINTENANCE_FAILED_JOB_RETENTION_SECONDS: "2592000",
    MAINTENANCE_FAILED_JOB_MAX_COUNT: "5000",
    NODE_ENV: "production"
  };

  return `${REQUIRED_ENV_KEYS.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}

function createKnownHostsInstructions() {
  return `# Pinned known_hosts handoff

This bundle does not contain a host key and does not create a known_hosts file.

Operator actions:

1. Obtain the staging host public key or fingerprint from the host owner through a trusted out-of-band channel.
2. Create the pinned known_hosts file outside this repository.
3. Inspect the file offline before target approval:

\`\`\`powershell
ssh-keygen -F <OPERATOR_STAGING_HOST> -f <EXTERNAL_PINNED_KNOWN_HOSTS_FILE>
ssh-keygen -l -E sha256 -f <OPERATOR_HOST_PUBLIC_KEY_FILE>
npm run staging:known-hosts:inspect -- --target <EXTERNAL_STAGING_TARGET_FILE>
\`\`\`

The later remote preflight must use BatchMode, StrictHostKeyChecking and the operator-owned pinned known_hosts file. A missing entry, mismatched fingerprint or host-key warning blocks the handoff.
`;
}

function createEnvironmentMarkerInstructions() {
  return `# Environment marker handoff

The staging host owner must pre-create the remote environment marker before any read-only remote preflight. This tool does not connect to the host and does not create the marker.

Required marker value:

\`\`\`text
staging
\`\`\`

Operator actions:

1. Use the marker path recorded in staging-target.template.json.
2. Ensure the marker is a regular file or equivalent operator-approved immutable marker.
3. Ensure the exact marker value is staging with no production alias.
4. Ensure the deploy user can read the marker noninteractively.

The next milestone reads the marker only. A missing marker, symlink marker or value mismatch blocks preflight.
`;
}

function createPackageHandoffRequirements() {
  return {
    schema_version: 1,
    application: RELEASE_IDENTITY.application,
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    release_package_required_after_remote_preflight: true,
    package_generated_by_handoff: false,
    deployable_artifact_included: false,
    image_transfer_performed: false,
    external_registry_publish_performed: false,
    package_source_commands: [
      "npm run release:package",
      "npm run release:package:verify",
      "npm run test:release-packaging"
    ],
    package_inventory_required: [
      "manifest.json",
      "checksums.sha256",
      "deploy/production/compose.yaml",
      "deploy/production/production.env.template",
      "metadata/sbom.cdx.json",
      "metadata/provenance.json",
      "image artifact generated by release packaging only"
    ],
    expected_services: [...EXPECTED_SERVICES],
    expected_public_routes: [...EXPECTED_PUBLIC_ROUTES],
    expected_migrations: [...EXPECTED_MIGRATIONS],
    local_rehearsal_is_remote_staging_evidence: false
  };
}

function createLocalRehearsalEvidence() {
  const relativeDoc = ".docs/local-staging-rehearsal.md";
  const absoluteDoc = path.resolve(relativeDoc);
  const bytes = readFileSync(absoluteDoc);
  const text = bytes.toString("utf8");

  return {
    schema_version: 1,
    evidence_type: "local-isolated-staging-rollback-dry-run",
    source_document: relativeDoc,
    source_document_sha256: sha256(bytes),
    local_rehearsal_passed: extractTick(text, "Status") === "Passed",
    remote_staging_preflight_performed: false,
    remote_staging_deployment_performed: false,
    production_deployment_performed: false,
    artifact_publication_performed: false,
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    previous_source_commit: extractTick(text, "Previous source commit"),
    candidate_source_commit: extractTick(text, "Runtime candidate source commit"),
    previous_package_sha256: extractTick(text, "Previous package SHA-256"),
    candidate_package_sha256: extractTick(text, "Candidate package SHA-256"),
    previous_image_id: extractTick(text, "Previous image ID"),
    candidate_image_id: extractTick(text, "Candidate image ID"),
    backup_sha256: extractTick(text, "Backup SHA-256"),
    tenant_auth_rehearsal_mode: extractTick(text, "Tenant auth rehearsal mode"),
    receipt_verification: extractTick(text, "Receipt verification"),
    restore_verification: extractTick(text, "Restore verification"),
    rollback_dry_run: extractTick(text, "Rollback dry-run"),
    roll_forward: extractTick(text, "Roll-forward"),
    teardown_verification: extractTick(text, "Teardown verification"),
    scheduler_verification: extractTick(text, "Scheduler verification")
  };
}

function renderOperatorChecklist(params, generatedAt) {
  const template = readText(path.resolve("deploy/staging/operator-checklist.template.md"));
  return template
    .replaceAll("{{APPLICATION}}", RELEASE_IDENTITY.application)
    .replaceAll("{{APPLICATION_VERSION}}", RELEASE_IDENTITY.version)
    .replaceAll("{{MASTER_RELEASE}}", RELEASE_IDENTITY.masterRelease)
    .replaceAll("{{MASTER_HASH}}", RELEASE_IDENTITY.masterSha256)
    .replaceAll("{{MASTER_COUNT}}", String(RELEASE_IDENTITY.masterActiveMarkdownCount))
    .replaceAll("{{PLATFORM}}", params.platform)
    .replaceAll("{{EDGE_MODE}}", params.edgeMode)
    .replaceAll("{{PROJECT_NAME}}", params.projectName)
    .replaceAll("{{API_PORT}}", String(params.apiPort))
    .replaceAll("{{GENERATED_AT}}", generatedAt);
}

function createManifest(params, generatedAt, payloadFiles) {
  return {
    schema_version: 1,
    bundle_type: "staging-operator-handoff",
    environment: "staging",
    application: RELEASE_IDENTITY.application,
    application_version: RELEASE_IDENTITY.version,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_hash: RELEASE_IDENTITY.masterSha256,
    master_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    generated_by: "scripts/staging-operator-handoff.mjs",
    generated_at: generatedAt,
    generated_parameters: {
      platform: params.platform,
      edge_mode: params.edgeMode,
      api_port: params.apiPort,
      compose_project_name: params.projectName
    },
    payload_files: payloadFiles,
    safety_flags: Object.fromEntries(SAFETY_FLAG_KEYS.map((key) => [key, false])),
    official_source_topics: [...OFFICIAL_SOURCE_TOPICS]
  };
}

function validateTrackedSchemas() {
  const hostSchema = readJson(path.resolve("deploy/staging/host-requirements.schema.json"));
  const handoffSchema = readJson(path.resolve("deploy/staging/operator-handoff.schema.json"));
  assert(hostSchema.properties?.application_version?.const === RELEASE_IDENTITY.version, "host schema application version mismatch");
  assert(handoffSchema.properties?.application_version?.const === RELEASE_IDENTITY.version, "handoff schema application version mismatch");
}

function validateManifest(manifest, checksumMap, root) {
  assert(manifest.schema_version === 1, "manifest schema_version must be 1");
  assert(manifest.bundle_type === "staging-operator-handoff", "manifest bundle_type mismatch");
  assert(manifest.environment === "staging", "manifest environment mismatch");
  assertIdentity(manifest, "manifest");
  assert(manifest.generated_by === "scripts/staging-operator-handoff.mjs", "manifest generated_by mismatch");
  assert(Number.isFinite(Date.parse(manifest.generated_at)), "manifest generated_at must be ISO");
  assert(manifest.generated_parameters?.platform === "linux/amd64", "manifest platform mismatch");
  assert(manifest.generated_parameters?.edge_mode === "loopback-only", "manifest edge_mode mismatch");
  assertPort(manifest.generated_parameters?.api_port, "manifest api_port");
  validateProjectName(manifest.generated_parameters?.compose_project_name);

  const payloadPaths = (manifest.payload_files ?? []).map((file) => file.path).sort();
  assertSameArray(payloadPaths, [...PAYLOAD_FILES].sort(), "manifest payload file list mismatch");
  for (const file of manifest.payload_files ?? []) {
    assert(PAYLOAD_FILES.includes(file.path), `unexpected manifest payload ${file.path}`);
    assert(file.sha256 === checksumMap.get(file.path), `manifest payload hash mismatch for ${file.path}`);
    assert(file.bytes === statSync(path.join(root, file.path)).size, `manifest payload size mismatch for ${file.path}`);
  }
  assertSameArray(Object.keys(manifest.safety_flags ?? {}).sort(), [...SAFETY_FLAG_KEYS].sort(), "manifest safety flag key mismatch");
  for (const key of SAFETY_FLAG_KEYS) {
    assert(manifest.safety_flags[key] === false, `manifest safety flag ${key} must be false`);
  }
  assertSameArray(manifest.official_source_topics, [...OFFICIAL_SOURCE_TOPICS], "manifest official source topics mismatch");
}

function validateHostRequirements(host, manifest) {
  assert(host.schema_version === 1, "host schema_version must be 1");
  assert(host.environment === "staging", "host environment mismatch");
  assertIdentity(host, "host requirements");
  assert(host.required_platform === "linux/amd64", "host platform mismatch");
  assert(host.operating_system === "Linux", "host OS mismatch");
  assert(host.docker_engine_required === true, "docker engine required");
  assert(host.docker_compose_v2_required === true, "docker compose v2 required");
  assert(host.noninteractive_docker_access_required === true, "noninteractive docker access required");
  assert(host.ssh_batch_mode_required === true, "SSH batch mode required");
  assert(host.pinned_known_hosts_required === true, "pinned known_hosts required");
  assert(host.remote_marker_required === true, "remote marker required");
  assert(host.remote_marker_value === "staging", "remote marker value mismatch");
  assert(host.production_compose_service_count === EXPECTED_SERVICES.length, "service count mismatch");
  assertSameArray(host.compose_services, [...EXPECTED_SERVICES], "service inventory mismatch");
  assert(host.api_binding === "loopback-only", "api binding must be loopback-only");
  assert(host.api_host_port === manifest.generated_parameters.api_port, "api port mismatch");
  assert(host.public_database_port_allowed === false, "database port must not be public");
  assert(host.public_redis_port_allowed === false, "redis port must not be public");
  assert(host.public_worker_port_allowed === false, "worker port must not be public");
  assert(host.persistent_postgresql_volume_required === true, "postgres volume required");
  assert(host.persistent_redis_volume_required === true, "redis volume required");
  assert(host.off_host_postgresql_backup_required_before_rollout === true, "off-host backup required");
  assert(host.resource_limits === "site-specific-after-benchmark", "resource limits must be site-specific");
  assert(host.capacity_model?.cpu_ram_not_invented === true, "capacity model must not invent CPU/RAM");
  assert(Array.isArray(host.capacity_model?.measurements_required_before_sizing), "capacity measurements missing");
  assert(host.capacity_model.single_host_failure_domain === true, "single-host limitation missing");
  assert(host.capacity_model.ha_claimed === false, "HA must not be claimed");
  validateMarkerPath(host.filesystem?.remote_environment_marker_path);
  validateRemoteBaseDir(host.filesystem?.remote_base_dir);
  assert(host.filesystem.release_layout_required === true, "release layout required");
  assert(host.filesystem.operator_owns_directory_creation === true, "operator directory ownership required");
  assert(host.filesystem.world_writable_paths_allowed === false, "world writable paths must be disallowed");
  assert(host.edge_conditions.production_hostname_allowed === false, "production hostname must be disallowed");
  assert(host.edge_conditions.production_ip_allowed === false, "production IP must be disallowed");
  assert(host.edge_conditions.public_database_or_redis_allowed === false, "public data ports must be disallowed");
  assert(host.edge_conditions.dns_tls_cyberpanel_live_change_performed === false, "DNS/TLS/CyberPanel must be false");
  assert(host.edge_conditions.external_registry_publish_performed === false, "registry publish must be false");
  assert(host.remote_preflight_required === true, "remote preflight required");
  assert(host.remote_mutation_performed === false, "remote mutation must be false");
  assert(host.remote_deployment_performed === false, "remote deployment must be false");
}

function validateTargetTemplate(target, host, manifest) {
  assert(target.environment === "staging", "target template environment mismatch");
  assert(target.approved === false, "target template must keep approved=false");
  assert(target.target_alias === "OPERATOR_REPLACE_WITH_STAGING_ALIAS", "target alias must be placeholder");
  assert(target.ssh_host === "OPERATOR_REPLACE_WITH_NON_PRODUCTION_STAGING_HOST", "ssh_host must be placeholder");
  assert(target.ssh_port === 22, "ssh_port placeholder default mismatch");
  assert(target.ssh_user === "OPERATOR_REPLACE_WITH_DEPLOY_USER", "ssh_user must be placeholder");
  assert(target.known_hosts_file === "OPERATOR_REPLACE_WITH_EXTERNAL_PINNED_KNOWN_HOSTS_FILE", "known_hosts_file must be placeholder");
  assert(target.remote_environment_marker_path === host.filesystem.remote_environment_marker_path, "marker path mismatch");
  assert(target.remote_environment_marker_value === "staging", "target marker value mismatch");
  assert(target.remote_base_dir === host.filesystem.remote_base_dir, "remote base dir mismatch");
  assert(target.compose_project_name === manifest.generated_parameters.compose_project_name, "compose project mismatch");
  assert(target.api_host_port === manifest.generated_parameters.api_port, "target API port mismatch");
  assert(target.edge_mode === "loopback-only", "target edge mode mismatch");
  assert(target.public_base_url === null, "loopback target must not set public_base_url");
  validateMarkerPath(target.remote_environment_marker_path);
  validateRemoteBaseDir(target.remote_base_dir);
}

function validateEnvTemplate(text, manifest) {
  const env = parseEnvText(text);
  assertSameArray(Object.keys(env), [...REQUIRED_ENV_KEYS], "staging env template key inventory mismatch");
  assert(env.MAIN_SERVICE_IMAGE === INCOMPLETE_IMAGE_MARKER, "env template must not select an image");
  assert(env.API_HOST_PORT === String(manifest.generated_parameters.api_port), "env template API port mismatch");
  assert(env.POSTGRES_USER === "main_service_staging", "POSTGRES_USER must be staging-specific");
  assert(env.POSTGRES_DB === "main_service_staging", "POSTGRES_DB must be staging-specific");
  assert(isPlaceholder(env.POSTGRES_PASSWORD), "POSTGRES_PASSWORD must be placeholder");
  assert(isPlaceholder(env.TENANT_RATE_LIMIT_KEY_SECRET), "TENANT_RATE_LIMIT_KEY_SECRET must be placeholder");
  assert(isPlaceholder(env.AGENT_KEY), "AGENT_KEY must be placeholder");
  assert(env.DATABASE_URL.includes("<STAGING_POSTGRES_PASSWORD_URL_ENCODED>"), "DATABASE_URL must contain password placeholder");
  assert(env.REDIS_URL === "redis://redis:6379/0", "REDIS_URL must target Compose redis service");
  assert(env.TENANT_AUTH_JWKS_URL === "<STAGING_HTTPS_JWKS_URL>", "JWKS URL must be placeholder");
  assert(env.TENANT_RATE_LIMIT_REDIS_PREFIX === "tenant_rate_limit:staging", "rate-limit prefix mismatch");
  assert(env.BULLMQ_PREFIX === "main-service-staging", "BullMQ prefix mismatch");
  assert(env.NODE_ENV === "production", "NODE_ENV mismatch");
}

function validatePackageRequirements(requirements) {
  assert(requirements.schema_version === 1, "package requirements schema mismatch");
  assertIdentity(requirements, "package requirements");
  assert(requirements.release_package_required_after_remote_preflight === true, "package requirement missing");
  assert(requirements.package_generated_by_handoff === false, "handoff must not generate package");
  assert(requirements.deployable_artifact_included === false, "handoff must not include deployable artifact");
  assert(requirements.image_transfer_performed === false, "handoff must not transfer images");
  assert(requirements.external_registry_publish_performed === false, "handoff must not publish registry artifact");
  assertSameArray(requirements.expected_services, [...EXPECTED_SERVICES], "package service inventory mismatch");
  assertSameArray(requirements.expected_public_routes, [...EXPECTED_PUBLIC_ROUTES], "package route inventory mismatch");
  assertSameArray(requirements.expected_migrations, [...EXPECTED_MIGRATIONS], "package migration inventory mismatch");
  assert(requirements.local_rehearsal_is_remote_staging_evidence === false, "local rehearsal must not be remote staging evidence");
}

function validateLocalRehearsalEvidence(evidence) {
  const expected = createLocalRehearsalEvidence();
  assert(JSON.stringify(evidence) === JSON.stringify(expected), "local rehearsal evidence does not match canonical doc");
  assert(evidence.local_rehearsal_passed === true, "local rehearsal must be passed");
  assert(evidence.remote_staging_preflight_performed === false, "local evidence must not claim remote preflight");
  assert(evidence.remote_staging_deployment_performed === false, "local evidence must not claim remote deployment");
  assert(evidence.production_deployment_performed === false, "local evidence must not claim production deployment");
}

function validateChecklistAndInstructions(checklist, knownHostsInstructions, markerInstructions) {
  const steps = [
    "1. generate handoff bundle",
    "2. hosting/operator reviews host requirements",
    "3. provision non-production host",
    "4. pre-create staging marker",
    "5. verify fingerprint out-of-band and create pinned known_hosts",
    "6. scaffold target/env externally",
    "7. set approved=true only after review",
    "8. fill/generate staging secrets",
    "9. local inputs verify",
    "10. known_hosts offline inspect",
    "11. provide STAGING_TARGET_FILE and STAGING_ENV_FILE"
  ];
  for (const step of steps) {
    assert(checklist.includes(step), `operator checklist missing ${step}`);
  }
  assert(knownHostsInstructions.includes("out-of-band"), "known_hosts instructions must require out-of-band fingerprint check");
  assert(knownHostsInstructions.includes("ssh-keygen -F"), "known_hosts instructions must include offline lookup");
  assert(knownHostsInstructions.includes("ssh-keygen -l -E sha256"), "known_hosts instructions must include fingerprint inspection");
  assert(markerInstructions.includes("staging"), "marker instructions must include staging value");
  assert(markerInstructions.includes("read-only remote preflight"), "marker instructions must keep next step read-only");
}

function assertExactBundleFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    assert(entry.isFile(), `bundle entry must be a file: ${entry.name}`);
  }
  const names = entries.map((entry) => entry.name).sort();
  assertSameArray(names, [...EXPECTED_BUNDLE_FILES].sort(), "bundle file inventory mismatch");
}

function verifyChecksums(root) {
  const text = readText(path.join(root, "checksums.sha256")).trim();
  assert(text !== "", "checksums.sha256 must not be empty");
  const checksumMap = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
    assert(match !== null, `malformed checksum line: ${line}`);
    const [, expected, relative] = match;
    assert(CHECKSUM_FILES.includes(relative), `unexpected checksum path ${relative}`);
    assert(!checksumMap.has(relative), `duplicate checksum for ${relative}`);
    const actual = sha256(readFileSync(path.join(root, relative)));
    assert(actual === expected, `checksum mismatch for ${relative}`);
    checksumMap.set(relative, expected);
  }
  assertSameArray([...checksumMap.keys()].sort(), [...CHECKSUM_FILES].sort(), "checksum inventory mismatch");
  return checksumMap;
}

function writeChecksums(root) {
  const lines = CHECKSUM_FILES.map((file) => `${sha256(readFileSync(path.join(root, file)))}  ${file}`);
  writeText(path.join(root, "checksums.sha256"), `${lines.join("\n")}\n`, 0o644);
}

function collectFileMetadata(root, files) {
  return files.map((file) => {
    const absolute = path.join(root, file);
    return {
      path: file,
      sha256: sha256(readFileSync(absolute)),
      bytes: statSync(absolute).size
    };
  });
}

function scanBundleText(root) {
  for (const file of CHECKSUM_FILES) {
    const text = readText(path.join(root, file));
    assert(!/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u.test(text), `private key pattern in ${file}`);
    assert(!/AKIA[0-9A-Z]{16}/u.test(text), `AWS key pattern in ${file}`);
    assert(!/Bearer [A-Za-z0-9._-]+/u.test(text), `bearer token pattern in ${file}`);
    assert(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(text), `JWT pattern in ${file}`);
    assert(!/(^|\n)[^\n#]*\s(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|rsa-sha2-\d+)\s+[A-Za-z0-9+/]{40,}={0,2}(?:\s|$)/u.test(text), `known_hosts key line in ${file}`);
    assert(!/\b(?:\d{1,3}\.){3}\d{1,3}\b/u.test(text), `IP address pattern in ${file}`);
    assert(!/\b(?:rss|auth|www)\.habersoft\.com\b/iu.test(text), `production host pattern in ${file}`);
    assert(!/[A-Za-z]:\\|\/Users\/|\/home\/|\/root\/|\/tmp\//u.test(text), `local path pattern in ${file}`);
    assert(!/ssh-keyscan/iu.test(text), `network host-key collection instruction in ${file}`);
    for (const url of text.match(/postgres(?:ql)?:\/\/[^\s"']+/giu) ?? []) {
      assert(url.includes("<STAGING_POSTGRES_PASSWORD_URL_ENCODED>"), `database URL is not placeholder-only in ${file}`);
    }
  }
}

function assertIdentity(value, label) {
  assert(value.application === RELEASE_IDENTITY.application, `${label} application mismatch`);
  assert(value.application_version === RELEASE_IDENTITY.version, `${label} version mismatch`);
  assert(value.master_release === RELEASE_IDENTITY.masterRelease, `${label} master release mismatch`);
  assert(value.master_hash === RELEASE_IDENTITY.masterSha256, `${label} master hash mismatch`);
  assert(value.master_count === RELEASE_IDENTITY.masterActiveMarkdownCount, `${label} master count mismatch`);
}

function validateMarkerPath(value) {
  const marker = normalizePosixPath(requiredString(value, "marker path"));
  assert(isAbsolutePosix(marker), "marker path must be absolute POSIX");
  assert(!containsTraversal(marker), "marker path must not contain traversal");
  assert(!["/", "/etc", "/var", "/home", "/root", "/tmp"].includes(marker), "marker path must not be a broad system directory");
}

function validateRemoteBaseDir(value) {
  const base = normalizePosixPath(requiredString(value, "remote base dir"));
  assert(isAbsolutePosix(base), "remote base dir must be absolute POSIX");
  assert(!containsTraversal(base), "remote base dir must not contain traversal");
  assert(base.toLowerCase().includes("staging"), "remote base dir must include staging");
  assert(!forbiddenRemoteBaseDirs.has(base), "remote base dir is a forbidden root directory");
  assert(allowedRemoteBasePrefixes.some((prefix) => base.startsWith(prefix)), "remote base dir must be under an allowed habersoft staging prefix");
}

function validateProjectName(projectName) {
  assert(/^[a-z0-9][a-z0-9-]{2,62}$/u.test(String(projectName ?? "")), "project-name must be a safe Docker Compose project name");
  assert(String(projectName).includes("staging"), "project-name must include staging");
  assert(!String(projectName).includes("production"), "project-name must not include production");
}

function parseEnvText(text) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    assert(separator > 0, `invalid env template line ${line}`);
    const key = line.slice(0, separator);
    assert(!seen.has(key), `duplicate env key ${key}`);
    seen.add(key);
    entries.push([key, line.slice(separator + 1)]);
  }
  return Object.fromEntries(entries);
}

function extractTick(text, label) {
  const pattern = new RegExp(`${escapeRegex(label)}:\\s*\`([^\`]+)\``, "u");
  const match = text.match(pattern);
  if (match === null) {
    throw new Error(`local rehearsal doc missing ${label}`);
  }
  return match[1];
}

function parsePort(value, name) {
  const numeric = Number(value);
  assertPort(numeric, name);
  assert(numeric !== 80 && numeric !== 443, `${name} must not be 80 or 443`);
  return numeric;
}

function assertPort(value, name) {
  assert(Number.isInteger(value) && value >= 1024 && value <= 65535, `${name} must be an integer between 1024 and 65535`);
}

function isPlaceholder(value) {
  return /^<[A-Z0-9_]+>$/.test(String(value ?? ""));
}

function requiredExternalPath(value, name) {
  const resolved = path.resolve(requiredString(value, name));
  assert(!isInsideRepo(resolved), `${name} must be outside the repository`);
  return resolved;
}

function isInsideRepo(file) {
  const relative = path.relative(repoRoot, path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
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

function readJson(file) {
  return JSON.parse(readText(file));
}

function readText(file) {
  return readFileSync(path.resolve(file), "utf8");
}

function writeJson(file, value, mode) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function writeText(file, value, mode) {
  writeFileSync(file, value, { mode });
  if (process.platform !== "win32") {
    chmodSync(file, mode);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertSameArray(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseArgs(rawArgs) {
  const result = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const next = rawArgs[index + 1];
    result[arg.slice(2)] = next?.startsWith("--") || next === undefined ? "true" : next;
    if (result[arg.slice(2)] !== "true") {
      index += 1;
    }
  }
  return result;
}

function fail(message) {
  console.error(`staging-operator-handoff: ${message}`);
  process.exit(1);
}
