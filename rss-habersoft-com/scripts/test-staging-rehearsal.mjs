import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertExternalOutputRoot,
  assertSafeProjectName,
  assertSafeTeardownScope,
  buildRehearsalEnv,
  compareLocalRehearsalPackagePair,
  createProjectName,
  createRehearsalReceipt,
  generateRehearsalSecrets,
  TENANT_AUTH_REHEARSAL_MODE,
  validateRehearsalReceipt
} from "./staging/local-rehearsal.mjs";
import { formatRuntimeImageEnv, parseRuntimeImageEnvText } from "./runtime-image-env.mjs";
import { EXPECTED_MIGRATIONS, EXPECTED_PUBLIC_ROUTES, EXPECTED_SERVICES, RELEASE_IDENTITY } from "./release-identity.mjs";

const temp = mkdtempSync(path.join(os.tmpdir(), "main-service-staging-rehearsal-tests-"));
try {
  const projectName = createProjectName("b".repeat(40));
  assert.match(projectName, /^main-service-ms017b2-[a-f0-9]{12}$/u);
  assert.doesNotThrow(() => assertSafeProjectName(projectName));
  assert.doesNotThrow(() => assertSafeTeardownScope(projectName));
  assert.throws(() => assertSafeTeardownScope("main-service"), /rehearsal|scoped/u);
  assert.throws(() => assertExternalOutputRoot(process.cwd()), /outside/u);
  assert.equal(assertExternalOutputRoot(temp), path.resolve(temp));

  const previous = manifest("a".repeat(40), "sha256:" + "1".repeat(64));
  const candidate = manifest("b".repeat(40), "sha256:" + "2".repeat(64));
  assert.doesNotThrow(() => compareLocalRehearsalPackagePair(previous, candidate, {
    previousSchemaSha256: "s".repeat(64),
    candidateSchemaSha256: "s".repeat(64),
    previousComposeSha256: "c".repeat(64),
    candidateComposeSha256: "c".repeat(64)
  }));
  assert.throws(() => compareLocalRehearsalPackagePair(previous, { ...candidate, source_commit: previous.source_commit }), /source commit/u);
  assert.throws(() => compareLocalRehearsalPackagePair(previous, { ...candidate, image: { included: true, id: previous.image.id } }), /image ids/u);
  assert.throws(() => compareLocalRehearsalPackagePair(previous, { ...candidate, services: ["api"] }), /services/u);
  assert.throws(() => compareLocalRehearsalPackagePair(previous, candidate, {
    previousSchemaSha256: "s".repeat(64),
    candidateSchemaSha256: "t".repeat(64)
  }), /schema/u);

  const secrets = generateRehearsalSecrets();
  const env = buildRehearsalEnv({
    apiPort: 13000,
    projectName,
    secrets
  });
  assert.equal(env.MAIN_SERVICE_IMAGE, undefined);
  assert.equal(parseRuntimeImageEnvText(formatRuntimeImageEnv("sha256:" + "3".repeat(64))).imageId, "sha256:" + "3".repeat(64));
  assert.equal(env.API_HOST_PORT, "13000");
  assert.equal(env.DATABASE_URL.includes(secrets.postgresPassword), true);
  assert.equal(env.TENANT_AUTH_JWKS_URL.startsWith("https://"), true);
  assert.equal(env.TENANT_AUTH_JWKS_URL.includes("tenant-auth-jwks-fixture"), false);
  assert.equal(env.BULLMQ_PREFIX.includes("rehearsal"), true);

  const receipt = validReceipt(projectName);
  assert.doesNotThrow(() => validateRehearsalReceipt(receipt));
  assert.throws(() => validateRehearsalReceipt({ ...receipt, remote_staging_contact_performed: true }), /remote_staging_contact/u);
  assert.throws(() => validateRehearsalReceipt({ ...receipt, project_name: "main-service" }), /project/u);
  assert.throws(() => validateRehearsalReceipt({ ...receipt, raw_path: "C:\\secret\\file" }), /forbidden receipt field/u);
  assert.throws(() => validateRehearsalReceipt({ ...receipt, previous_image_id: receipt.candidate_image_id }), /image ids/u);

  console.log("test-staging-rehearsal: ok");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function manifest(sourceCommit, imageId) {
  return {
    version: RELEASE_IDENTITY.version,
    source_commit: sourceCommit,
    master_release: RELEASE_IDENTITY.masterRelease,
    master_sha256: RELEASE_IDENTITY.masterSha256,
    master_active_markdown_count: RELEASE_IDENTITY.masterActiveMarkdownCount,
    migrations: [...EXPECTED_MIGRATIONS],
    public_routes: [...EXPECTED_PUBLIC_ROUTES],
    services: [...EXPECTED_SERVICES],
    image: { included: true, id: imageId },
    runtime_image_env: { included: true, path: "deploy/runtime-image.env", key: "MAIN_SERVICE_IMAGE", image_id: imageId, sha256: "9".repeat(64) }
  };
}

function validReceipt(projectName) {
  return createRehearsalReceipt({
    previous_source_commit: "a".repeat(40),
    candidate_source_commit: "b".repeat(40),
    previous_package_sha256: "c".repeat(64),
    candidate_package_sha256: "d".repeat(64),
    previous_image_id: "sha256:" + "1".repeat(64),
    candidate_image_id: "sha256:" + "2".repeat(64),
    migration_inventory: [...EXPECTED_MIGRATIONS],
    tenant_auth_rehearsal_mode: TENANT_AUTH_REHEARSAL_MODE,
    project_name: projectName,
    service_inventory: [...EXPECTED_SERVICES],
    candidate_deploy_verified: true,
    api_ready_verified: true,
    worker_health_verified: true,
    sentinel_verified: true,
    backup_sha256: "e".repeat(64),
    restore_verified: true,
    rollback_verified: true,
    roll_forward_verified: true,
    scheduler_verified: true,
    teardown_verified: true,
    started_at: "2026-06-21T10:00:00.000Z",
    finished_at: "2026-06-21T11:00:00.000Z"
  });
}
