import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

const successCode =
  "SUCCESS_MS_027A_R2_PRODUCTION_PROMOTION_AND_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTANCE_CLOSED_OPERATOR_REPORTED";
const feedOnboardingSourceStatus =
  "SUCCESS_MS_027A_ADMIN_FEED_ONBOARDING_AND_ELIGIBLE_TARGET_READINESS_LANDED_OPERATOR_DEPLOY_RETEST_REQUIRED";
const imageFreshnessStatus =
  "SUCCESS_MS_027A_R1_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_REMEDIATION_LANDED_OPERATOR_RETEST_REQUIRED";
const imageFreshnessAccepted = "MS-027A-R2_PRODUCTION_PROMOTION_IMAGE_FRESHNESS_ACCEPTED_OPERATOR_REPORTED";
const feedOnboardingRouteSmokeAccepted = "MS-027A-R2_FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED_OPERATOR_REPORTED";
const pendingEffect = "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET";
const startOriginMain = "d205f9b540a6afc0195263eefba3d9fd83866c39";
const acceptanceDoc = ".docs/production-feed-onboarding-acceptance.md";
const safeReceiptPath =
  "E:\\Codex\\rss-habersoft-com\\operator-state\\admin-ui-production-activation\\ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json";
const docReceiptPath =
  "operator-state/admin-ui-production-activation/ms-027a-r2-promotion-feed-onboarding-route-smoke-accepted-operator-reported-receipt.json";

assertPackageScript();
assertRequiredFiles();
assertDocs();

if (failures.length > 0) {
  for (const failure of failures) console.error(`production-feed-onboarding-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "production-feed-onboarding-acceptance-verify-ok",
      result: successCode,
      start_origin_main: startOriginMain,
      evidence_source: "operator_reported",
      production_contact: false,
      production_mutation: false,
      codex_credentialed_production_login: false,
      accepted_operator_retest: "OPERATOR_PROMOTION_RETEST_REDACTED_OK",
      image_freshness: imageFreshnessAccepted,
      backend_runtime_revision: "matched_current_HEAD",
      frontend_runtime_revision: "matched_current_HEAD",
      route_proof: "NGINX_ROUTE_PROOF_ACCEPTED",
      feed_onboarding_route_smoke: feedOnboardingRouteSmokeAccepted,
      browser_evidence_verifier: "browser-evidence-verify-ok",
      browser_evidence_classifications: [
        "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
        "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE"
      ],
      feed_recheck_effect_status: pendingEffect,
      receipt_path: safeReceiptPath,
      output: "redacted"
    },
    null,
    2
  )
);

function assertPackageScript() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  if (
    scripts["verify:production-feed-onboarding-acceptance"] !==
    "node scripts/production-feed-onboarding-acceptance-verify.mjs"
  ) {
    failures.push("package.json missing verify:production-feed-onboarding-acceptance");
  }
}

function assertRequiredFiles() {
  for (const file of [
    acceptanceDoc,
    "scripts/production-feed-onboarding-acceptance-verify.mjs",
    "scripts/production-readiness-verify.mjs",
    "scripts/operator-automation-verify.mjs",
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/production-image-freshness-verify.mjs",
    "scripts/admin-feed-onboarding-verify.mjs",
    "scripts/browser-evidence-verify.mjs",
    "src/adminOperations/browserEvidence.ts"
  ]) {
    const absolute = path.resolve(frontendRoot, file);
    if (!existsSync(absolute)) failures.push(`missing required file: ${file}`);
  }
}

function assertDocs() {
  const docs = [
    readRoot("README.md"),
    readRoot("PRODUCTION.md"),
    readFrontend("README.md"),
    readFrontend("PRODUCTION.md"),
    readFrontend(acceptanceDoc),
    readFrontend(".docs/operator-risk-model.md"),
    readFrontend(".docs/production-activation-package.md"),
    readFrontend(".docs/admin-operations-dashboard.md"),
    readFrontend(".docs/admin-auth-production-operator-handoff.md"),
    readFrontend(".docs/operator-automation-acceptance.md"),
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");

  for (const fragment of [
    successCode,
    feedOnboardingSourceStatus,
    imageFreshnessStatus,
    imageFreshnessAccepted,
    feedOnboardingRouteSmokeAccepted,
    "operator_reported",
    startOriginMain,
    "OPERATOR_PROMOTION_RETEST_REDACTED_OK",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "FEED_ONBOARDING_ROUTE_SMOKE_ACCEPTED",
    "browser-evidence-verify-ok",
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "backend runtime image revision matched current HEAD",
    "frontend runtime image revision matched current HEAD",
    "image freshness accepted",
    "feed onboarding route smoke accepted",
    "authenticated browser evidence accepted",
    pendingEffect,
    "no production contact by Codex",
    "No production feed was created, seeded, or faked",
    "No fake actionRef was generated",
    "verify:production-feed-onboarding-acceptance",
    docReceiptPath,
    "naturally existing eligible target",
    "redacted browser evidence",
    "Feed recheck effect acceptance remains future work"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing MS-027A-R2 acceptance fragment: ${fragment}`);
  }

  assertNoFeedEffectOverclaim(docs);
  assertNoFeedOnboardingEndToEndOverclaim(docs);
  assertNoSeedOrFakeAcceptancePath(docs);
  assertNoSecretRequiredForEvidence(docs);
  assertNoCodexProductionAuthorityOverclaim(docs);
}

function assertNoFeedEffectOverclaim(docs) {
  const r2ScopedDocs = docs
    .split(/\r?\n/u)
    .filter((line) => !isMs027bR1EffectAcceptanceLine(line))
    .join("\n");
  const forbidden = [
    /feed recheck effect acceptance is closed/iu,
    /feed recheck effect accepted(?:\s|:)/iu,
    /feed_recheck_effect_status["`]?\s*[:=]\s*["`]?FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED/iu,
    /SUCCESS_MS_027A_R2[^\n]{0,240}BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED/iu
  ];
  for (const pattern of forbidden) {
    if (pattern.test(r2ScopedDocs)) failures.push(`docs overclaim feed recheck effect acceptance: ${pattern}`);
  }

  for (const line of docs.split(/\r?\n/u)) {
    if (
      line.includes("BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED") &&
      !isMs027bR1EffectAcceptanceLine(line) &&
      !/\b(future|reserved|only when|may close only when)\b/iu.test(line)
    ) {
      failures.push("docs mention feed effect accepted classification outside future-only context");
    }
  }
}

function assertNoFeedOnboardingEndToEndOverclaim(docs) {
  const r2ScopedDocs = docs
    .split(/\r?\n/u)
    .filter((line) => !isMs027bR1EffectAcceptanceLine(line))
    .join("\n");
  const forbidden = [
    /feed onboarding end-to-end (?:effect )?acceptance (?:is )?(?:closed|accepted)/iu,
    /feed onboarding effect acceptance (?:is )?(?:closed|accepted)/iu,
    /BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE[^\n]{0,160}\b(?:closes|accepts|accepted)[^\n]{0,160}\b(?:effect|end-to-end)\b/iu
  ];
  for (const pattern of forbidden) {
    if (pattern.test(r2ScopedDocs)) failures.push(`docs overclaim feed onboarding effect acceptance: ${pattern}`);
  }
}

function isMs027bR1EffectAcceptanceLine(line) {
  return /\b(?:MS-027B|MS-027B-R1|SUCCESS_MS_027B_R1|FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTED|production-feed-effect-acceptance|ms-027b-r1-feed-onboarding-recheck-effect)\b/u.test(
    line
  );
}

function assertNoSeedOrFakeAcceptancePath(docs) {
  for (const line of docs.split(/\r?\n/u)) {
    if (!/\b(?:seed(?:ed|ing)?|fake(?:d)?|creating|created|create)\b/iu.test(line)) continue;
    if (!/(production feed|actionRef|prod-data|production data)/iu.test(line)) continue;
    if (!/\b(no|not|do not|must not|never|forbid|unauthori[sz]ed|without|did not|was not|is not|not accepted|not allowed)\b/iu.test(line)) {
      failures.push(`docs may authorize seed/fake production target path: ${line.trim()}`);
    }
  }
}

function assertNoSecretRequiredForEvidence(docs) {
  const forbidden =
    /\b(?:browser evidence|operator evidence|route smoke|receipt|acceptance)[^\n]{0,160}\b(?:requires|required|must include|must supply)[^\n]{0,120}\b(?:secret|credential|cookie|session|csrf|idempotency|actionRef|raw feed URL|raw production bod)/iu;
  for (const line of docs.split(/\r?\n/u)) {
    if (!forbidden.test(line)) continue;
    if (/\b(redacted|redact|do not|must not|no|without|forbid|reject)\b/iu.test(line)) continue;
    failures.push(`docs require secret-bearing material for R2 evidence closure: ${line.trim()}`);
  }
}

function assertNoCodexProductionAuthorityOverclaim(docs) {
  for (const line of docs.split(/\r?\n/u)) {
    if (!/\bCodex\b/iu.test(line)) continue;
    if (!/\b(production contact|production mutation|credentialed production login|mutate production|read real secrets)\b/iu.test(line)) continue;
    if (!/\b(no|not|does not|did not|without|fail closed|fails closed|CRITICAL|risk|boundary|guardrail)\b/iu.test(line)) {
      failures.push(`docs may overclaim Codex production authority: ${line.trim()}`);
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
