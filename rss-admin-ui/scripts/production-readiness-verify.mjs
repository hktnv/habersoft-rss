import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const gitRevision = git(["rev-parse", "HEAD"], repoRoot);
const image =
  process.env.RSS_ADMIN_UI_READINESS_IMAGE ??
  process.env.RSS_ADMIN_UI_TEST_IMAGE ??
  "rss-admin-ui:ms027a-r2-local";
const productionHostPattern = /(?:^|[/:.])rss(?:-panel)?\.habersoft\.com(?:$|[/:])/iu;
const rootComposeEnv = {
  RSS_HABERSOFT_COM_IMAGE: "habersoft-rss-backend:ms026c-r1-local",
  RSS_ADMIN_UI_IMAGE: image,
  ADMIN_UI_HOST_PORT: "8081",
  ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
  ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "",
  ADMIN_UI_ENVIRONMENT_NAME: "production-readiness-local",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  POSTGRES_DB: "rss_habersoft",
  DATABASE_URL: "postgresql://postgres:postgres@postgres:5432/rss_habersoft?schema=public",
  REDIS_URL: "redis://redis:6379/0"
};
const productionComposeEnv = {
  RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
  ADMIN_UI_AUTH_UPSTREAM_ORIGIN: "",
  ADMIN_UI_ENVIRONMENT_NAME: "production-readiness-local",
  ADMIN_UI_HOST_PORT: "8081"
};

console.log(JSON.stringify({ status: "production-readiness-verify-start", image }, null, 2));
const drilldownAcceptanceStatus = "MS-025B-R1_OPERATIONS_DRILLDOWN_PRODUCTION_ACCEPTED_OPERATOR_REPORTED";
const feedRecheckStatus = "MS-026A_BOUNDED_ADMIN_FEED_RECHECK_ACTION_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const feedOnboardingStatus = "SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const operatorAutomationStatus = "SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET";
const feedOnboardingAcceptanceStatus =
  "SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED";
const feedOnboardingRecheckEffectStatus =
  "SUCCESS_MS_027B_FEED_ONBOARDING_RECHECK_EFFECT_FLOW_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const feedOnboardingRecheckEffectAcceptanceStatus =
  "SUCCESS_MS_027B_R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTANCE_CLOSED_OPERATOR_REPORTED_EVIDENCE_AUTOMATION_LANDED";
const evidenceRegressionModeStatus =
  "SUCCESS_MS_027B_R2_EVIDENCE_AUTOMATION_REGRESSION_MODE_LANDED_OPERATOR_RETEST_OPTIONAL";
const evidenceRegressionAcceptanceStatus =
  "SUCCESS_MS_027B_R3_LIVE_EVIDENCE_REGRESSION_ACCEPTANCE_CLOSED_RECHECK_NOT_RETESTED_EXPECTED";

run("node", ["--version"]);
run("npm", ["--version"]);
run("docker", ["version", "--format", "{{.Server.Version}}"], { cwd: repoRoot });
assertNoProductionContactEnv(rootComposeEnv);
assertNoProductionContactEnv(productionComposeEnv);

run("npm", ["run", "build"]);
run("npm", ["run", "verify:admin-operations-dashboard"]);
run("npm", ["run", "verify:admin-operations-drilldown"]);
run("npm", ["run", "verify:admin-feed-recheck-action"]);
run("npm", ["run", "verify:admin-feed-onboarding"]);
run("npm", ["run", "verify:feed-onboarding-recheck-effect-flow"]);
run("npm", ["run", "verify:operator-automation"]);
run("npm", ["run", "verify:operator-automation-acceptance"]);
run("npm", ["run", "verify:production-image-freshness"]);
run("npm", ["run", "verify:production-feed-onboarding-acceptance"]);
run("npm", ["run", "verify:production-feed-effect-acceptance"]);
run("npm", ["run", "verify:evidence-regression-mode"]);
run("npm", ["run", "verify:evidence-regression-acceptance"]);
run("npm", ["run", "verify:browser-evidence"]);
run("npm", ["run", "verify:production-operations-acceptance"]);
run("npm", ["run", "verify:production-operations-drilldown-acceptance"]);
run("docker", [
  "build",
  "-t",
  image,
  "--build-arg",
  `HABERSOFT_IMAGE_REVISION=${gitRevision}`,
  "--build-arg",
  "HABERSOFT_IMAGE_SOURCE=https://github.com/hktnv/habersoft-rss",
  "."
], { printOutput: false, timeoutMs: 600000 });
console.log(JSON.stringify({ status: "docker-build-ok", image }));

run("docker", ["compose", "config", "--quiet"], {
  cwd: repoRoot,
  env: rootComposeEnv
});
run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"]);
run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
  env: productionComposeEnv
});
run(
  "docker",
  [
    "compose",
    "-f",
    path.join("deploy", "production", "compose.yaml"),
    "-f",
    path.join("deploy", "production", "compose.backend-network.yaml"),
    "config",
    "--quiet"
  ],
  {
    env: {
      ...productionComposeEnv,
      ADMIN_UI_BACKEND_DOCKER_NETWORK: "main-service-production_default"
    }
  }
);

run("npm", ["run", "test:proxy-security"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "test:status-api-production-networking"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "verify:production-overlay-canonicalization"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "test:auth-session-sentinel"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "test:auth-proxy"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "test:admin-api-proxy-template"], {
  env: {
    RSS_ADMIN_UI_ADMIN_API_TEMPLATE_IMAGE: image,
    RSS_ADMIN_UI_ADMIN_API_TEMPLATE_SKIP_BUILD: "true"
  },
  timeoutMs: 600000
});
run("npm", ["run", "test:admin-operations-proxy"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});

console.log(
  JSON.stringify(
    {
      status: "production-readiness-verify-ok",
      image,
      drilldown_acceptance: drilldownAcceptanceStatus,
      feed_recheck_action: feedRecheckStatus,
      feed_onboarding: feedOnboardingStatus,
      operator_automation: operatorAutomationStatus,
      feed_onboarding_acceptance: feedOnboardingAcceptanceStatus,
      feed_onboarding_recheck_effect_flow: feedOnboardingRecheckEffectStatus,
      feed_onboarding_recheck_effect_acceptance: feedOnboardingRecheckEffectAcceptanceStatus,
      evidence_regression_mode: evidenceRegressionModeStatus,
      evidence_regression_acceptance: evidenceRegressionAcceptanceStatus,
      checks: [
        "production build exists",
        "admin operations dashboard source/docs/proxy verifier passes",
        "admin operations drilldown source/docs/proxy verifier passes",
        "bounded admin feed recheck action verifier passes",
        "authenticated admin feed onboarding verifier passes",
        "MS-027B feed onboarding plus recheck effect flow verifier passes",
        "MS-026C operator automation verifier passes",
        "MS-026C-R1 operator automation acceptance verifier passes",
        "MS-027A-R1 production image freshness verifier passes",
        "MS-027A-R2 production promotion/feed-onboarding route-smoke acceptance verifier passes",
        "MS-027B-R1 feed onboarding plus recheck effect production acceptance verifier passes",
        "MS-027B-R2 evidence regression-mode verifier passes",
        "MS-027B-R3 live evidence regression acceptance verifier passes",
        "MS-026C browser evidence verifier passes",
        "MS-025A-R2 operator-reported operations acceptance verifier passes",
        "MS-025B-R1 operator-reported operations drilldown acceptance verifier passes",
        "docker image builds",
        "frontend production compose config passes without env file for inspection defaults",
        "missing upstream origin starts static runtime and fails closed at route level",
        "invalid upstream origins start static runtime and fail closed at route level",
        "safe synthetic upstream accepted",
        "healthz and static app served",
        "browser config excludes upstream origin and API base",
        "exact health route proxy security passes",
        "status-api production networking harness passes",
        "production overlay canonicalization harness passes",
        "same-origin admin session sentinel fails closed",
        "same-origin admin auth proxy exact-route security passes",
        "generated admin-api proxy template route proof passes",
        "same-origin admin operations summary proxy exact-route security passes",
        "root compose config passes with synthetic values",
        "frontend production compose config passes with synthetic values",
        "frontend backend-network production compose overlay passes with synthetic values",
        "no production hostname used by verifier command environments"
      ]
    },
    null,
    2
  )
);

function assertNoProductionContactEnv(env) {
  for (const [name, value] of Object.entries(env)) {
    if (productionHostPattern.test(String(value))) {
      throw new Error(`production hostname is not allowed in local verifier env: ${name}`);
    }
  }
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args);
  const env = { ...process.env, ...(options.env ?? {}) };
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd ?? frontendRoot,
    env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (options.printOutput !== false && stdout.trim() !== "") process.stdout.write(stdout);
  if (options.printOutput !== false && stderr.trim() !== "") process.stderr.write(stderr);

  if (result.error !== undefined) {
    throw result.error;
  }

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
  return result;
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 30000
  });
  if (result.status !== 0) return "unavailable";
  return result.stdout.trim();
}

function resolveCommand(command, args) {
  if (command === "npm" && process.env.npm_execpath !== undefined) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  if (command === "npm" && process.platform === "win32") {
    const npmCli = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) return { executable: process.execPath, args: [npmCli, ...args] };
  }
  return { executable: command, args };
}
