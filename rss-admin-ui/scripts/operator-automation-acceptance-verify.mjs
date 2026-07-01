import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const failures = [];

const successCode = "SUCCESS_MS_026C_R1_OPERATOR_AUTOMATION_PRODUCTION_ACCEPTANCE_CLOSED_FEED_RECHECK_PENDING_NO_TARGET";
const pendingEffect = "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET";
const acceptanceDoc = ".docs/operator-automation-acceptance.md";
const safeReceiptPath =
  "E:\\Codex\\rss-habersoft-com\\operator-state\\admin-ui-production-activation\\ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json";
const docReceiptPath =
  "operator-state/admin-ui-production-activation/ms-026c-r1-operator-automation-accepted-feed-recheck-pending-no-target-receipt.json";

assertPackageScript();
assertRequiredFiles();
assertDocs();
assertBrowserEvidenceBoundary();

if (failures.length > 0) {
  for (const failure of failures) console.error(`operator-automation-acceptance-verify: ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "operator-automation-acceptance-verify-ok",
      result: successCode,
      evidence_source: "operator_reported",
      production_contact: false,
      production_mutation: false,
      accepted_operator_retest: "OPERATOR_PROMOTION_RETEST_REDACTED_OK",
      route_proof: "NGINX_ROUTE_PROOF_ACCEPTED",
      browser_evidence_verifier: "browser-evidence-verify-ok",
      browser_evidence_classifications: [
        "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
        "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
      ],
      feed_recheck_effect_status: pendingEffect,
      critical_risk: "none",
      receipt_path: safeReceiptPath,
      output: "redacted"
    },
    null,
    2
  )
);

function assertPackageScript() {
  const scripts = JSON.parse(readFrontend("package.json")).scripts ?? {};
  if (scripts["verify:operator-automation-acceptance"] !== "node scripts/operator-automation-acceptance-verify.mjs") {
    failures.push("package.json missing verify:operator-automation-acceptance");
  }
}

function assertRequiredFiles() {
  for (const file of [
    acceptanceDoc,
    "scripts/operator-automation-acceptance-verify.mjs",
    "scripts/operator-production-promotion-retest.mjs",
    "scripts/browser-evidence-verify.mjs",
    "scripts/operator-automation-verify.mjs",
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
    readBackend("README.md"),
    readBackend("PRODUCTION.md")
  ].join("\n");

  for (const fragment of [
    successCode,
    "operator_reported",
    "e66caf608ee5ce2460c3f832f46400bc340413ab",
    "OPERATOR_PROMOTION_RETEST_REDACTED_OK",
    "NGINX_ROUTE_PROOF_ACCEPTED",
    "browser-evidence-verify-ok",
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    pendingEffect,
    "critical risk `none`",
    "no production contact by Codex",
    "No production feed was created, seeded, or faked",
    "No fake actionRef was generated",
    "verify:operator-automation-acceptance",
    docReceiptPath,
    "real eligible production feed",
    "redacted browser evidence",
    "Feed recheck effect acceptance remains future work"
  ]) {
    if (!docs.includes(fragment)) failures.push(`docs missing acceptance fragment: ${fragment}`);
  }

  assertNoFeedEffectOverclaim(docs);
  assertNoSeedOrFakeAcceptancePath(docs);
  assertNoSecretRequiredForBrowserEvidence(docs);
}

function assertBrowserEvidenceBoundary() {
  const verifier = readFrontend("scripts/browser-evidence-verify.mjs");
  for (const fragment of [
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    pendingEffect,
    "forbiddenKeyPattern",
    "cookie",
    "session",
    "csrf",
    "idempotency",
    "actionref",
    "url",
    "unknown_field"
  ]) {
    if (!verifier.toLowerCase().includes(fragment.toLowerCase())) {
      failures.push(`browser evidence verifier missing safety fragment: ${fragment}`);
    }
  }
}

function assertNoFeedEffectOverclaim(docs) {
  const forbidden = [
    /feed recheck effect acceptance is closed/iu,
    /feed recheck effect accepted(?:\s|:)/iu,
    /feed_recheck_effect_status["`]?\s*[:=]\s*["`]?FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED/iu,
    /SUCCESS_MS_026C_R1[^\n]{0,240}BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED/iu
  ];
  for (const pattern of forbidden) {
    if (pattern.test(docs)) failures.push(`docs overclaim feed recheck effect acceptance: ${pattern}`);
  }

  for (const line of docs.split(/\r?\n/u)) {
    if (
      line.includes("BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED") &&
      !/\b(future|reserved|only when|may close only when)\b/iu.test(line)
    ) {
      failures.push("docs mention feed effect accepted classification outside future-only context");
    }
  }
}

function assertNoSeedOrFakeAcceptancePath(docs) {
  for (const line of docs.split(/\r?\n/u)) {
    if (!/\b(?:seed(?:ed|ing)?|fake(?:d)?|create(?:d|s)?|creating)\b/iu.test(line)) continue;
    if (!/(production feed|actionRef|prod-data|production data)/iu.test(line)) continue;
    if (!/\b(no|not|do not|must not|never|forbid|unauthori[sz]ed|without|did not|was not|is not|not accepted|not allowed)\b/iu.test(line)) {
      failures.push(`docs may authorize seed/fake production target path: ${line.trim()}`);
    }
  }
}

function assertNoSecretRequiredForBrowserEvidence(docs) {
  const forbidden = /\b(?:browser evidence|no eligible|no-target)[^\n]{0,160}\b(?:requires|required|must include|must supply)[^\n]{0,120}\b(?:secret|credential|cookie|session|csrf|idempotency|actionRef|raw feed URL)\b/iu;
  if (forbidden.test(docs)) failures.push("docs require secret-bearing material for no-target browser evidence closure");
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
