import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_IMAGE_SOURCE,
  buildImage,
  classifyImageFreshness,
  currentGitRevision,
  dockerBuildArgs,
  inspectImage,
  localPromotionTag,
  readEnvValue,
  writeEnvAssignment
} from "../../scripts/production-image-freshness-lib.mjs";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(backendRoot, "..");
const composeFile = path.join("deploy", "production", "compose.yaml");
const sharedEnvFile = ".env.production";
const runtimeImageEnvFile = path.join("deploy", "runtime-image.env");
const args = process.argv.slice(2);
const apply = args.includes("--apply") || process.env.MAIN_SERVICE_RECREATE_APPLY === "true";
const requestedDryRun = args.includes("--dry-run");
const dryRun = requestedDryRun || !apply;
const recreateOnly = args.includes("--recreate-only") || process.env.MAIN_SERVICE_RECREATE_ONLY === "true";
const apiOnly = args.includes("--api-only");
const workerOnly = args.includes("--worker-only");
const help = args.includes("--help") || args.includes("-h");
const revision = currentGitRevision(repoRoot);
const imageSource = process.env.HABERSOFT_IMAGE_SOURCE ?? CANONICAL_IMAGE_SOURCE;
const imageTag = optionValue("--image-tag") ?? process.env.MAIN_SERVICE_PROMOTION_IMAGE_TAG ?? localPromotionTag("backend", revision);
const runtimeImageEnvPath = path.join(backendRoot, runtimeImageEnvFile);

if (help) {
  writeJson(helpOutput());
  process.exit(0);
}

if (args.some((arg) => /^--(?:username|password|token|secret)(?:=|$)/iu.test(arg))) {
  fail("credentials and secrets must not be supplied on production recreate command lines");
}
if (apply && requestedDryRun) {
  fail("--apply and --dry-run cannot be combined");
}
if (apiOnly && workerOnly) {
  fail("--api-only and --worker-only cannot be combined");
}

const runtimeImage = readEnvValue(runtimeImageEnvPath, "MAIN_SERVICE_IMAGE");
const missingOperatorFiles = requiredOperatorFiles().filter((file) => !existsSync(path.join(backendRoot, file)));
const services = apiOnly ? ["main-service-api"] : workerOnly ? ["main-service-worker"] : ["main-service-api", "main-service-worker"];
const composeArgs = [
  "--env-file",
  sharedEnvFile,
  "--env-file",
  runtimeImageEnvFile,
  "-f",
  composeFile,
  "up",
  "-d",
  "--no-build",
  "--pull",
  "never",
  "--force-recreate",
  ...services
];
const currentFreshness = runtimeImage === undefined
  ? classifyImageFreshness({ component: "backend", image: "missing", expectedRevision: revision, expectedSource: imageSource, inspectResult: { ok: false, image: "missing", reason: "image_reference_missing", id: "unavailable", labels: {} } })
  : classifyImageFreshness({ component: "backend", image: runtimeImage, expectedRevision: revision, expectedSource: imageSource });

if (dryRun) {
  writeJson(summary(recreateOnly ? "backend-api-worker-recreate-dry-run" : "backend-api-worker-recreate-dry-run"));
  process.exit(0);
}

if (missingOperatorFiles.length > 0) {
  writeJson(summary("backend-api-worker-recreate-blocked", {
    blocking_classification: "source_not_promoted",
    reason: "required operator production file is missing"
  }));
  process.exit(1);
}

let selectedImage = runtimeImage;
let freshness = currentFreshness;
if (recreateOnly) {
  if (!freshness.fresh) {
    writeJson(summary("backend-api-worker-recreate-blocked", {
      image_freshness: freshness,
      blocking_classification: "backend_image_stale",
      reason: "recreate-only requested but runtime image revision is not current HEAD"
    }));
    process.exit(1);
  }
} else {
  const build = buildImage({
    component: "backend",
    cwd: backendRoot,
    dockerfile: "Dockerfile",
    context: ".",
    tag: imageTag,
    revision,
    source: imageSource
  });
  if (!build.ok) {
    writeJson(summary("backend-api-worker-recreate-blocked", {
      build,
      blocking_classification: "backend_image_stale",
      reason: "backend image build failed"
    }));
    process.exit(build.exit_code);
  }
  const inspected = inspectImage(imageTag, { cwd: backendRoot });
  freshness = classifyImageFreshness({
    component: "backend",
    image: imageTag,
    expectedRevision: revision,
    expectedSource: imageSource,
    inspectResult: inspected
  });
  if (!freshness.fresh) {
    writeJson(summary("backend-api-worker-recreate-blocked", {
      image_freshness: freshness,
      blocking_classification: "backend_image_stale",
      reason: "built backend image did not carry current HEAD labels"
    }));
    process.exit(1);
  }
  selectedImage = inspected.id;
  writeEnvAssignment(runtimeImageEnvPath, "MAIN_SERVICE_IMAGE", selectedImage);
}

writeJson(summary("backend-api-worker-recreate-apply", {
  image_freshness: freshness,
  selected_image: selectedImage,
  runtime_image_env_written: !recreateOnly
}));
runCompose(composeArgs);

function summary(status, extra = {}) {
  const buildPreview = ["docker", ...dockerBuildArgs({
    dockerfile: "Dockerfile",
    context: ".",
    tag: imageTag,
    revision,
    source: imageSource
  })].join(" ");
  const imageFreshness = extra.image_freshness ?? currentFreshness;
  const blocking = extra.blocking_classification;
  return {
    status,
    dry_run: dryRun,
    apply,
    apply_required_for_mutation: true,
    promotion_mode: recreateOnly ? "recreate_only_existing_image" : "build_current_head_then_recreate",
    git_revision: revision,
    image_source: imageSource,
    image_freshness: imageFreshness,
    classifications: [
      ...(blocking === undefined ? [] : [blocking]),
      imageFreshness.classification
    ],
    build: {
      will_build: !recreateOnly,
      dockerfile: "Dockerfile",
      context: ".",
      tag: imageTag,
      command_preview: buildPreview
    },
    runtime_image_env: {
      path: runtimeImageEnvFile,
      present: existsSync(runtimeImageEnvPath),
      will_write: apply && !dryRun && !recreateOnly,
      key: "MAIN_SERVICE_IMAGE",
      value: extra.selected_image === undefined ? "redacted" : "redacted"
    },
    compose_file: composeFile,
    env_files: missingOperatorFiles.length === 0 ? [sharedEnvFile, runtimeImageEnvFile] : "missing",
    missing_operator_files: missingOperatorFiles,
    services,
    command_classification: "operator_mutating_when_apply_true",
    command_preview: ["docker", "compose", ...composeArgs].join(" "),
    admin_auth_runtime_env: "main-service-api",
    worker_admin_auth_env: "absent_by_design",
    restart_safety: "--no-build --pull never --force-recreate is allowed only after backend image freshness is proven current",
    reason: extra.reason,
    next_steps: nextSteps(status),
    output: "redacted"
  };
}

function requiredOperatorFiles() {
  return recreateOnly ? [sharedEnvFile, runtimeImageEnvFile] : [sharedEnvFile];
}

function nextSteps(status) {
  if (status === "backend-api-worker-recreate-blocked") {
    return [
      "confirm the production checkout is at origin/main with git pull --ff-only origin main",
      "rerun npm run ops:production:recreate:api-worker -- --apply to build a current-HEAD backend image",
      "use --recreate-only only for restart-only recovery after image labels already match current HEAD"
    ];
  }
  return [
    "verify operator rollback/current-state evidence before --apply",
    "run npm run production:admin-auth:diagnose:redacted before or after backend recreate",
    "after backend image freshness is proven and API/worker are recreated, run cd ../rss-admin-ui && npm run ops:compose:recreate -- --apply",
    "then run npm run ops:production:retest:redacted from rss-admin-ui"
  ];
}

function runCompose(composeArgsToRun) {
  const result = spawnSync("docker", ["compose", ...composeArgsToRun], {
    cwd: backendRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 180000
  });

  if ((result.stdout ?? "") !== "") process.stdout.write(result.stdout);
  if ((result.stderr ?? "") !== "") process.stderr.write(result.stderr);

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function helpOutput() {
  return {
    status: "backend-api-worker-recreate-help",
    usage: "node scripts/production-api-worker-recreate.mjs [--dry-run|--apply] [--recreate-only] [--api-only|--worker-only] [--image-tag IMAGE]",
    default: "dry-run",
    apply_policy: "--apply builds a current-HEAD backend image, verifies OCI revision/source labels, writes deploy/runtime-image.env, then recreates API/worker",
    recreate_only_policy: "--recreate-only performs no build and blocks unless the existing MAIN_SERVICE_IMAGE labels match current HEAD",
    credential_policy: "credentials and secrets are never accepted as CLI arguments",
    output: "redacted"
  };
}

function optionValue(name) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact !== undefined) return exact.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  process.stderr.write(`production-api-worker-recreate: ${message}\n`);
  process.exit(1);
}
