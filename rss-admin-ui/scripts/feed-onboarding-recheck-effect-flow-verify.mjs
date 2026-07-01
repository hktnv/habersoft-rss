import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const status = "SUCCESS_MS_027B_FEED_ONBOARDING_RECHECK_EFFECT_FLOW_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const failures = [];

assertStaticContracts();
assertRuntimeEvidenceBridge();

if (failures.length > 0) {
  for (const failure of failures) console.error(`feed-onboarding-recheck-effect-flow-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "feed-onboarding-recheck-effect-flow-verify-ok",
      milestone: status,
      backend_effect_supported: true,
      one_command_operator_path: "ops:production:retest",
      browser_evidence_script: "ops:browser-evidence:verify",
      production_contact: false,
      output: "redacted"
    },
    null,
    2
  )
);

function assertStaticContracts() {
  const frontendPackage = JSON.parse(readFrontend("package.json"));
  if (frontendPackage.scripts?.["verify:feed-onboarding-recheck-effect-flow"] !== "node scripts/feed-onboarding-recheck-effect-flow-verify.mjs") {
    failures.push("package.json missing verify:feed-onboarding-recheck-effect-flow");
  }

  for (const file of [
    "src/adminOperations/browserEvidence.ts",
    "src/adminOperations/OperationsDrilldown.tsx",
    "src/adminOperations/FeedOnboardingPanel.tsx",
    "scripts/browser-evidence-verify.mjs",
    "scripts/operator-production-retest.mjs",
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/operator-risk-model.mjs",
    "scripts/root-fullstack-acceptance.mjs",
    "scripts/production-mode-rc.mjs",
    "../rss-habersoft-com/src/admin-api/admin-feed-onboarding.service.ts",
    "../rss-habersoft-com/src/admin-api/admin-feed-recheck.service.ts"
  ]) {
    requireFile(path.resolve(frontendRoot, file), file);
  }

  const evidence = readFrontend("src/adminOperations/browserEvidence.ts");
  const evidenceVerifier = readFrontend("scripts/browser-evidence-verify.mjs");
  for (const fragment of [
    "MS-027B",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
    "feed_onboarding_effect_status"
  ]) {
    if (!evidence.includes(fragment) && !evidenceVerifier.includes(fragment)) {
      failures.push(`browser evidence bridge missing ${fragment}`);
    }
  }

  const drilldown = readFrontend("src/adminOperations/OperationsDrilldown.tsx");
  for (const fragment of ["feedOnboardingResult", "createRedactedBrowserEvidence(drilldown, feedRechecks, feedOnboardingResult)", "onFeedOnboardingResult"]) {
    if (!drilldown.includes(fragment)) failures.push(`OperationsDrilldown missing effect evidence handoff: ${fragment}`);
  }

  const panel = readFrontend("src/adminOperations/FeedOnboardingPanel.tsx");
  if (!panel.includes("onResult?.(nextResult)")) failures.push("FeedOnboardingPanel does not expose safe parsed onboarding result");

  const lowLevelRetest = readFrontend("scripts/operator-production-retest.mjs");
  for (const fragment of [
    "--browser-evidence",
    "AUTHENTICATED_BROWSER_EVIDENCE_ACCEPTED",
    "feed_onboarding_effect_status",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED"
  ]) {
    if (!lowLevelRetest.includes(fragment)) failures.push(`operator production retest missing ${fragment}`);
  }

  const promotion = readFrontend("scripts/operator-production-promotion-retest.mjs");
  for (const fragment of [
    "ms-027b-feed-onboarding-recheck-effect-retest-receipt.json",
    "feed_onboarding_effect_status",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
  ]) {
    if (!promotion.includes(fragment)) failures.push(`one-command promotion retest missing ${fragment}`);
  }

  const risk = readFrontend("scripts/operator-risk-model.mjs");
  for (const fragment of ["MS-027B_RISK_BALANCED_GUARDRAILS", "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION", "PENDING_FEED_RECHECK_COOLDOWN"]) {
    if (!risk.includes(fragment)) failures.push(`risk model missing ${fragment}`);
  }

  const fullstack = readFrontend("scripts/root-fullstack-acceptance.mjs");
  const rc = readFrontend("scripts/production-mode-rc.mjs");
  for (const fragment of [
    "feed_onboarding_recheck_status",
    "onboarding.example.org",
    "onboardedEligibleFeed",
    "already_pending"
  ]) {
    if (!fullstack.includes(fragment)) failures.push(`root fullstack flow missing ${fragment}`);
    if (!rc.includes(fragment)) failures.push(`production-mode RC flow missing ${fragment}`);
  }

  const onboardingService = readBackend("src/admin-api/admin-feed-onboarding.service.ts");
  for (const fragment of [
    "ADMIN_FEED_ONBOARDING_SITE_CLIENT_ID",
    "siteFeed.create",
    "subscriberCount: { increment: 1 }",
    "eligibleForRecheck",
    "nextCheckAt: feed.subscriberCount <= 0 ? now"
  ]) {
    if (!onboardingService.includes(fragment)) failures.push(`backend onboarding effect support missing ${fragment}`);
  }
  if (/\bfetch\s*\(/iu.test(onboardingService)) failures.push("backend onboarding performs synchronous external fetch");

  const recheckService = readBackend("src/admin-api/admin-feed-recheck.service.ts");
  for (const fragment of ["updateMany", "nextCheckAt: now", "cooldownSeconds = 300", "parseFeedRecheckActionRef"]) {
    if (!recheckService.includes(fragment)) failures.push(`backend feed recheck effect support missing ${fragment}`);
  }

  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");
  for (const fragment of [
    status,
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "npm run verify:feed-onboarding-recheck-effect-flow",
    "No production feed was created, seeded, or faked"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-027B fragment: ${fragment}`);
  }
}

function assertRuntimeEvidenceBridge() {
  const tempRoot = path.join(repoRoot, "..", ".codex-ms027b-verify-tmp");
  mkdirSync(tempRoot, { recursive: true });
  const evidenceFile = path.join(tempRoot, "accepted-browser-evidence.json");
  try {
    const evidence = {
      schema: "habersoft-admin-browser-evidence-v1",
      source: "admin-ui",
      milestone: "MS-027B",
      generatedAt: "2026-07-01T10:00:00.000Z",
      authenticated: true,
      operations: {
        drilldownStatus: "ok",
        drilldownGeneratedAt: "2026-07-01T09:59:00.000Z",
        feeds: {
          total: 1,
          active: 1,
          rows: 1,
          eligibleRecheckTargets: 1,
          noEligibleFeedRecheckTarget: false
        },
        ingestion: {
          rows: 0,
          recentEntryCount: 0,
          recentBatchCount: 0
        }
      },
      feedRecheck: {
        effectStatus: "FEED_RECHECK_EFFECT_ACCEPTED",
        lastActionClassification: "FEED_RECHECK_ACTION_ACCEPTED"
      },
      feedOnboarding: {
        feed_onboarding_available: true,
        feed_onboarding_status: "accepted",
        no_eligible_target: false,
        critical_risk: "none",
        effectStatus: "FEED_ONBOARDING_EFFECT_ACCEPTED",
        lastActionClassification: "FEED_ONBOARDING_ACTION_ACCEPTED"
      },
      classifications: [
        "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
        "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
        "FEED_ONBOARDING_EFFECT_ACCEPTED",
        "FEED_RECHECK_EFFECT_ACCEPTED",
        "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
      ]
    };
    const text = `${JSON.stringify(evidence, null, 2)}\n`;
    writeFileSync(evidenceFile, text, { encoding: "utf8", mode: 0o600 });
    const result = spawnSync(process.execPath, ["scripts/browser-evidence-verify.mjs", "--file", evidenceFile], {
      cwd: frontendRoot,
      encoding: "utf8",
      shell: false,
      timeout: 30000
    });
    const parsed = parseJson(result.stdout);
    if (result.status !== 0 || parsed?.status !== "browser-evidence-verify-ok") {
      failures.push("browser evidence verifier did not accept MS-027B accepted-effect evidence");
    }
    if (parsed?.feed_onboarding_effect_status !== "FEED_ONBOARDING_EFFECT_ACCEPTED") {
      failures.push("browser evidence verifier did not report feed onboarding effect status");
    }
    if (parsed?.feed_recheck_effect_status !== "FEED_RECHECK_EFFECT_ACCEPTED") {
      failures.push("browser evidence verifier did not report feed recheck effect status");
    }
    if (!/^[a-f0-9]{64}$/u.test(parsed?.evidence_sha256 ?? "")) {
      failures.push("browser evidence verifier did not return a redacted evidence digest");
    }
    const expectedDigest = createHash("sha256").update(text).digest("hex");
    if (parsed?.evidence_sha256 !== expectedDigest) failures.push("browser evidence verifier digest mismatch");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function requireFile(file, label) {
  if (!existsSync(file)) failures.push(`missing required file: ${label}`);
}

function parseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function readRoot(relative) {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

function readFrontend(relative) {
  return readFileSync(path.join(frontendRoot, relative), "utf8");
}

function readBackend(relative) {
  return readFileSync(path.join(backendRoot, relative), "utf8");
}
