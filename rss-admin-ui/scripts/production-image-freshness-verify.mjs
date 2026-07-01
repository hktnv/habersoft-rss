import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_IMAGE_SOURCE,
  IMAGE_REVISION_LABEL,
  IMAGE_SOURCE_LABEL,
  classifyImageFreshness,
  currentGitRevision,
  dockerBuildArgs,
  inspectImage,
  setEnvAssignmentText
} from "../../scripts/production-image-freshness-lib.mjs";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];
const warnings = [];
const revision = currentGitRevision(repoRoot);
const successCode = "SUCCESS_MS_027A_R1_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED";

assertStaticContracts();
assertClassifierContracts();
await assertDryRunContracts();
assertSyntheticDockerImages();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-image-freshness-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-image-freshness-verify-ok",
      result: successCode,
      backend_image_stale: "covered",
      frontend_image_stale: "covered",
      recreate_only_false_success: "blocked_by_label_contract",
      dry_run_mutation: false,
      docker_synthetic_images: warnings.includes("docker-unavailable") ? "skipped_docker_unavailable" : "covered",
      classifications: [
        "source_not_promoted",
        "backend_image_stale",
        "frontend_image_stale",
        "backend_route_missing",
        "frontend_route_missing",
        "nginx_template_marker_unresolved",
        "auth_not_configured",
        "unauthenticated_expected",
        "no_eligible_feed_target",
        "accepted_route_smoke_pending_effect"
      ],
      production_contact: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertStaticContracts() {
  const backendDockerfile = readBackend("Dockerfile");
  const frontendDockerfile = readFrontend("Dockerfile");
  for (const [label, text] of [["backend", backendDockerfile], ["frontend", frontendDockerfile]]) {
    for (const fragment of [
      "ARG HABERSOFT_IMAGE_REVISION=unknown",
      "ARG HABERSOFT_IMAGE_SOURCE=https://github.com/hktnv/habersoft-rss",
      `LABEL ${IMAGE_REVISION_LABEL}=$HABERSOFT_IMAGE_REVISION`,
      `LABEL ${IMAGE_SOURCE_LABEL}=$HABERSOFT_IMAGE_SOURCE`
    ]) {
      if (!text.includes(fragment)) failures.push(`${label} Dockerfile missing OCI label fragment: ${fragment}`);
    }
  }

  const backendScript = readBackend("scripts/production-api-worker-recreate.mjs");
  for (const fragment of [
    "build_current_head_then_recreate",
    "recreate_only_existing_image",
    "backend_image_stale",
    "source_not_promoted",
    "dockerBuildArgs",
    "writeEnvAssignment",
    "--recreate-only",
    "--no-build",
    "--pull",
    "never",
    "--force-recreate"
  ]) {
    if (!backendScript.includes(fragment)) failures.push(`backend recreate helper missing freshness fragment: ${fragment}`);
  }

  const frontendScript = readFrontend("scripts/production-compose-ops.mjs");
  for (const fragment of [
    "build_current_head_then_recreate",
    "recreate_only_existing_image",
    "frontend_image_stale",
    "dockerBuildArgs",
    "writeEnvAssignment",
    "--recreate-only",
    "--no-build",
    "--pull",
    "never",
    "--force-recreate"
  ]) {
    if (!frontendScript.includes(fragment)) failures.push(`frontend compose helper missing freshness fragment: ${fragment}`);
  }

  const promotionRetest = readFrontend("scripts/operator-production-promotion-retest.mjs");
  for (const fragment of [
    "source_not_promoted",
    "backend_image_stale",
    "frontend_image_stale",
    "backend_route_missing",
    "frontend_route_missing",
    "nginx_template_marker_unresolved",
    "auth_not_configured",
    "unauthenticated_expected",
    "no_eligible_feed_target",
    "accepted_route_smoke_pending_effect"
  ]) {
    if (!promotionRetest.includes(fragment)) failures.push(`promotion retest missing classification fragment: ${fragment}`);
  }

  const frontendScripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  if (frontendScripts["verify:production-image-freshness"] !== "node scripts/production-image-freshness-verify.mjs") {
    failures.push("frontend package.json missing verify:production-image-freshness");
  }
}

function assertClassifierContracts() {
  const freshLabels = {
    [IMAGE_REVISION_LABEL]: revision,
    [IMAGE_SOURCE_LABEL]: CANONICAL_IMAGE_SOURCE
  };
  const staleLabels = {
    [IMAGE_REVISION_LABEL]: "0".repeat(40),
    [IMAGE_SOURCE_LABEL]: CANONICAL_IMAGE_SOURCE
  };
  const missingLabels = {};

  assertClassification("backend fresh labels", classifyImageFreshness({
    component: "backend",
    image: "synthetic-backend:fresh",
    expectedRevision: revision,
    inspectResult: { ok: true, image: "synthetic-backend:fresh", id: "sha256:fresh", labels: freshLabels }
  }), "backend_image_current");
  assertClassification("backend stale labels", classifyImageFreshness({
    component: "backend",
    image: "synthetic-backend:stale",
    expectedRevision: revision,
    inspectResult: { ok: true, image: "synthetic-backend:stale", id: "sha256:stale", labels: staleLabels }
  }), "backend_image_stale");
  assertClassification("frontend fresh labels", classifyImageFreshness({
    component: "frontend",
    image: "synthetic-frontend:fresh",
    expectedRevision: revision,
    inspectResult: { ok: true, image: "synthetic-frontend:fresh", id: "sha256:fresh", labels: freshLabels }
  }), "frontend_image_current");
  assertClassification("frontend missing labels", classifyImageFreshness({
    component: "frontend",
    image: "synthetic-frontend:missing",
    expectedRevision: revision,
    inspectResult: { ok: true, image: "synthetic-frontend:missing", id: "sha256:missing", labels: missingLabels }
  }), "frontend_image_stale");

  const syntheticImageId = `sha256:${"a".repeat(64)}`;
  const updated = setEnvAssignmentText("ADMIN_UI_HOST_PORT=8081\nRSS_ADMIN_UI_IMAGE=old\n", "RSS_ADMIN_UI_IMAGE", syntheticImageId);
  if (!updated.includes(`RSS_ADMIN_UI_IMAGE=${syntheticImageId}`)) {
    failures.push("env assignment update did not replace RSS_ADMIN_UI_IMAGE");
  }
}

async function assertDryRunContracts() {
  const backend = runNode(backendRoot, ["scripts/production-api-worker-recreate.mjs", "--dry-run"]);
  assertJsonStatus(backend, "backend-api-worker-recreate-dry-run", "backend dry-run");
  if (backend.json?.build?.will_build !== true) failures.push("backend dry-run does not preview a build-current-HEAD promotion");
  if (!String(backend.json?.build?.command_preview ?? "").includes(`HABERSOFT_IMAGE_REVISION=${revision}`)) {
    failures.push("backend dry-run build preview does not include current revision build arg");
  }
  if (!String(backend.json?.command_preview ?? "").includes("--no-build --pull never --force-recreate")) {
    failures.push("backend dry-run compose preview lost no-build force-recreate restart command");
  }

  const backendRecreateOnly = runNode(backendRoot, ["scripts/production-api-worker-recreate.mjs", "--dry-run", "--recreate-only"]);
  assertJsonStatus(backendRecreateOnly, "backend-api-worker-recreate-dry-run", "backend recreate-only dry-run");
  if (backendRecreateOnly.json?.promotion_mode !== "recreate_only_existing_image") {
    failures.push("backend recreate-only dry-run did not identify restart-only mode");
  }

  const frontend = runNode(frontendRoot, ["scripts/production-compose-ops.mjs", "recreate", "--dry-run"]);
  assertJsonStatus(frontend, "frontend-production-compose-command-ready", "frontend dry-run");
  if (frontend.json?.build?.will_build !== true) failures.push("frontend dry-run does not preview a build-current-HEAD promotion");
  if (!String(frontend.json?.build?.command_preview ?? "").includes(`HABERSOFT_IMAGE_REVISION=${revision}`)) {
    failures.push("frontend dry-run build preview does not include current revision build arg");
  }
  if (frontend.json?.env_update?.will_write !== false) failures.push("frontend dry-run would mutate env");

  const frontendRecreateOnly = runNode(frontendRoot, ["scripts/production-compose-ops.mjs", "recreate", "--dry-run", "--recreate-only"]);
  assertJsonStatus(frontendRecreateOnly, "frontend-production-compose-command-ready", "frontend recreate-only dry-run");
  if (frontendRecreateOnly.json?.promotion_mode !== "recreate_only_existing_image") {
    failures.push("frontend recreate-only dry-run did not identify restart-only mode");
  }

  for (const result of [backend, backendRecreateOnly, frontend, frontendRecreateOnly]) {
    assertSanitized(result.stdout);
  }
}

function assertSyntheticDockerImages() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  if (docker.status !== 0) {
    warnings.push("docker-unavailable");
    return;
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "habersoft-image-freshness-"));
  const freshTag = `habersoft-image-freshness:fresh-${process.pid}`;
  const staleTag = `habersoft-image-freshness:stale-${process.pid}`;
  try {
    writeFileSync(path.join(tempRoot, "Dockerfile"), [
      "FROM scratch",
      "ARG HABERSOFT_IMAGE_REVISION=unknown",
      "ARG HABERSOFT_IMAGE_SOURCE=https://github.com/hktnv/habersoft-rss",
      "LABEL org.opencontainers.image.revision=$HABERSOFT_IMAGE_REVISION",
      "LABEL org.opencontainers.image.source=$HABERSOFT_IMAGE_SOURCE",
      ""
    ].join("\n"));
    runDocker(dockerBuildArgs({
      dockerfile: "Dockerfile",
      context: ".",
      tag: freshTag,
      revision,
      source: CANONICAL_IMAGE_SOURCE
    }), tempRoot);
    runDocker(dockerBuildArgs({
      dockerfile: "Dockerfile",
      context: ".",
      tag: staleTag,
      revision: "1".repeat(40),
      source: CANONICAL_IMAGE_SOURCE
    }), tempRoot);

    assertClassification("docker fresh backend image", classifyImageFreshness({
      component: "backend",
      image: freshTag,
      expectedRevision: revision,
      inspectResult: inspectImage(freshTag, { cwd: tempRoot })
    }), "backend_image_current");
    assertClassification("docker stale frontend image", classifyImageFreshness({
      component: "frontend",
      image: staleTag,
      expectedRevision: revision,
      inspectResult: inspectImage(staleTag, { cwd: tempRoot })
    }), "frontend_image_stale");
  } finally {
    runDocker(["image", "rm", "-f", freshTag, staleTag], tempRoot, { allowFailure: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runDocker(args, cwd, options = {}) {
  const result = spawnSync("docker", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });
  if (!options.allowFailure && result.status !== 0) {
    failures.push(`docker ${args.join(" ")} failed with status ${result.status}`);
  }
  return result;
}

function runNode(cwd, nodeArgs) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 120000
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

function assertJsonStatus(result, expectedStatus, label) {
  if (result.status !== 0) failures.push(`${label} exited ${result.status}: ${result.stderr}`);
  if (result.json?.status !== expectedStatus) {
    failures.push(`${label} returned ${result.json?.status ?? "unparseable"}, expected ${expectedStatus}`);
  }
}

function assertClassification(label, result, expected) {
  if (result.classification !== expected) failures.push(`${label} classified ${result.classification}, expected ${expected}`);
}

function assertSanitized(text) {
  for (const forbidden of [
    /cookie/iu,
    /csrf/iu,
    /idempotency/iu,
    /actionRef/iu,
    /feedUrl/iu,
    /password/iu,
    /secret/iu
  ]) {
    if (forbidden.test(text)) failures.push(`dry-run output leaked forbidden text: ${forbidden}`);
  }
}

function readFrontend(relative) {
  return readFileSync(path.join(frontendRoot, relative), "utf8");
}

function readBackend(relative) {
  return readFileSync(path.join(backendRoot, relative), "utf8");
}
