import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(repoRoot, "rss-habersoft-com");
const args = process.argv.slice(2);
const schema = "habersoft-admin-browser-evidence-v1";
const maxBytes = 32768;
const forbiddenKeyPattern = /(?:cookie|session|csrf|idempotency|actionref|action_ref|secret|password|token|authorization|bearer|raw|url|href|host|hostname|path|stack|filesystem|storage)/iu;
const forbiddenStringPattern = /feed_recheck_v1\.|https?:\/\/|Set-Cookie|Authorization|Bearer\s+|csrf|idempotency|[A-Z]:\\|\/(?:home|var|etc|tmp)\//iu;
const selfTest = args.includes("--self-test");
const regressionMode = args.includes("--regression-mode") || args.includes("--acceptance-ledger-continuity");
const noPriorAcceptanceLedger = args.includes("--no-prior-acceptance-ledger");
const runtimeOptions = { regressionMode, noPriorAcceptanceLedger };
const receiptOut = optionValue("--receipt-out") ?? optionValue("--receipt-file");
const evidenceFile = optionValue("--file") ?? positionalFile();
const evidenceStdin = args.includes("--stdin") || args.includes("--browser-evidence-stdin");

if (args.includes("--help") || args.includes("-h")) {
  writeJson({
    status: "browser-evidence-verify-help",
    usage: "node scripts/browser-evidence-verify.mjs (--file redacted-browser-evidence.json|--stdin) [--regression-mode] [--receipt-out receipt.json]",
    self_test: "node scripts/browser-evidence-verify.mjs --self-test",
    acceptance_modes: {
      initial: "fresh onboarding acceptance requires FEED_ONBOARDING_EFFECT_ACCEPTED",
      regression: "use --regression-mode after tracked MS-027B-R1 acceptance to classify already-present/not-retested onboarding as ledger continuity"
    },
    accepted_classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
      "FEED_ONBOARDING_EFFECT_ACCEPTED",
      "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
      "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
      "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
      "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
      "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
      "PENDING_FEED_RECHECK_COOLDOWN",
      "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
      "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
      "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
    ],
    output: "redacted"
  });
  process.exit(0);
}

if (args.some((arg) => /^--(?:username|password|cookie|csrf|token|idempotency|actionRef|secret)(?:=|$)/iu.test(arg))) {
  fail("credentials, cookies, CSRF tokens, actionRefs, idempotency keys, and secrets must not be supplied");
}

if (selfTest) {
  await runSelfTest();
  process.exit(0);
}

if (evidenceFile !== undefined && evidenceStdin) {
  fail("--file and --stdin cannot be combined");
}

if (evidenceFile === undefined && !evidenceStdin) {
  fail("--file or --stdin is required unless --self-test is used");
}

const result = evidenceStdin ? await verifyEvidenceStdin(runtimeOptions) : await verifyEvidenceFile(evidenceFile, runtimeOptions);
await maybeWriteReceipt(result);
writeJson(result);
if (result.status !== "browser-evidence-verify-ok") process.exit(1);

export async function verifyEvidenceFile(file, options = runtimeOptions) {
  const absolute = path.resolve(file);
  let text;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    return invalid("file_unreadable");
  }

  const bytes = Buffer.byteLength(text, "utf8");
  const digest = createHash("sha256").update(text).digest("hex");
  const validation = validateEvidenceText(text);
  if (!validation.valid) {
    return {
      status: "browser-evidence-verify-invalid",
      classification: "BROWSER_EVIDENCE_INVALID",
      reason: validation.reason,
      evidence_sha256: digest,
      bytes,
      output: "redacted"
    };
  }

  return acceptedResult(validation, digest, bytes, options);
}

export async function verifyEvidenceStdin(options = runtimeOptions) {
  const text = await readStdin(maxBytes + 1);
  return verifyEvidenceText(text, options);
}

export function verifyEvidenceText(text, options = runtimeOptions) {
  const bytes = Buffer.byteLength(text, "utf8");
  const digest = createHash("sha256").update(text).digest("hex");
  const validation = validateEvidenceText(text);
  if (!validation.valid) {
    return {
      status: "browser-evidence-verify-invalid",
      classification: "BROWSER_EVIDENCE_INVALID",
      reason: validation.reason,
      evidence_sha256: digest,
      bytes,
      output: "redacted"
    };
  }

  return acceptedResult(validation, digest, bytes, options);
}

function acceptedResult(validation, digest, bytes, options) {
  const semantics = classifyEvidenceSemantics(validation.evidence, validation.classifications, options);
  return {
    status: "browser-evidence-verify-ok",
    classifications: semantics.classifications,
    requested_acceptance_mode: options.regressionMode ? "regression_continuity" : "fresh_initial_acceptance",
    prior_acceptance_ledger: semantics.priorAcceptanceLedger ? "MS_027B_R1_ACCEPTED_TRACKED" : "absent_or_disabled",
    onboarding_acceptance_disposition: semantics.onboardingDisposition,
    feed_recheck_effect_status: validation.evidence.feedRecheck.effectStatus,
    no_eligible_feed_recheck_target: validation.evidence.operations.feeds.noEligibleFeedRecheckTarget,
    feed_onboarding_available: validation.evidence.feedOnboarding.feed_onboarding_available,
    feed_onboarding_status: validation.evidence.feedOnboarding.feed_onboarding_status,
    feed_onboarding_effect_status: semantics.feedOnboardingEffectStatus,
    no_eligible_target: validation.evidence.feedOnboarding.no_eligible_target,
    critical_risk: validation.evidence.feedOnboarding.critical_risk,
    evidence_sha256: digest,
    bytes,
    output: "redacted"
  };
}

function classifyEvidenceSemantics(evidence, rawClassifications, options) {
  const priorAcceptanceLedger = options.regressionMode === true && options.noPriorAcceptanceLedger !== true && hasPriorMs027bAcceptanceLedger();
  const classifications = new Set(rawClassifications);
  const rawOnboardingStatus = evidence.feedOnboarding.effectStatus ?? "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON";
  const feedRecheckAccepted =
    evidence.feedRecheck.effectStatus === "FEED_RECHECK_EFFECT_ACCEPTED" ||
    rawClassifications.includes("FEED_RECHECK_EFFECT_ACCEPTED") ||
    rawClassifications.includes("BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED");
  const alreadyPresent =
    rawOnboardingStatus === "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE" ||
    evidence.feedOnboarding.feed_onboarding_status === "already_present" ||
    evidence.feedOnboarding.lastActionClassification === "FEED_ONBOARDING_ACTION_ALREADY_EXISTS";
  const noFreshOnboardingEffect = rawOnboardingStatus === "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON" || alreadyPresent;
  const onboardingRejected =
    rawOnboardingStatus === "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION" ||
    rawClassifications.includes("FEED_ONBOARDING_REJECTED_SAFE_VALIDATION");

  if (rawOnboardingStatus === "FEED_ONBOARDING_EFFECT_ACCEPTED") {
    return {
      classifications: [...classifications],
      feedOnboardingEffectStatus: "FEED_ONBOARDING_EFFECT_ACCEPTED",
      priorAcceptanceLedger,
      onboardingDisposition: "FRESH_ONBOARDING_EFFECT_ACCEPTED"
    };
  }

  if (priorAcceptanceLedger && noFreshOnboardingEffect && !onboardingRejected) {
    classifications.delete("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON");
    classifications.add(
      alreadyPresent
        ? "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE"
        : "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED"
    );
    classifications.add("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK");
    if (feedRecheckAccepted) classifications.add("RECHECK_EFFECT_ACCEPTED_REGRESSION_OK");
    return {
      classifications: [...classifications],
      feedOnboardingEffectStatus: alreadyPresent
        ? "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE"
        : "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
      priorAcceptanceLedger,
      onboardingDisposition: feedRecheckAccepted
        ? "REGRESSION_CONTINUITY_RECHECK_ACCEPTED_ONBOARDING_PREVIOUSLY_ACCEPTED"
        : "REGRESSION_CONTINUITY_ONBOARDING_PREVIOUSLY_ACCEPTED_RECHECK_PENDING"
    };
  }

  if (noFreshOnboardingEffect) {
    classifications.add("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON");
    return {
      classifications: [...classifications],
      feedOnboardingEffectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      priorAcceptanceLedger,
      onboardingDisposition: "PENDING_INITIAL_ONBOARDING_EFFECT_EVIDENCE"
    };
  }

  return {
    classifications: [...classifications],
    feedOnboardingEffectStatus: rawOnboardingStatus,
    priorAcceptanceLedger,
    onboardingDisposition: onboardingRejected ? "ONBOARDING_EVIDENCE_REJECTED_SAFE_VALIDATION" : "ONBOARDING_EVIDENCE_PENDING_OR_ATTENTION_REQUIRED"
  };
}

export function validateEvidenceText(text) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) return invalidValidation("overlarge");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidValidation("invalid_json");
  }
  return validateEvidence(value);
}

export function validateEvidence(value) {
  if (!isRecord(value)) return invalidValidation("not_object");
  const forbidden = findForbiddenEvidenceSurface(value);
  if (forbidden === "field") return invalidValidation("forbidden_field");
  if (forbidden === "value") return invalidValidation("forbidden_value");
  if (!hasOnlyKeys(value, ["schema", "source", "milestone", "generatedAt", "authenticated", "operations", "feedRecheck", "feedOnboarding", "classifications"])) {
    return invalidValidation("unknown_field");
  }
  if (
    value.schema !== schema ||
    value.source !== "admin-ui" ||
    (value.milestone !== "MS-026C" && value.milestone !== "MS-027B") ||
    value.authenticated !== true ||
    !isIso(value.generatedAt) ||
    !isOperationsEvidence(value.operations) ||
    !isFeedRecheckEvidence(value.feedRecheck) ||
    !isFeedOnboardingEvidence(value.feedOnboarding) ||
    !isClassifications(value.classifications)
  ) {
    return invalidValidation("invalid_schema");
  }
  return { valid: true, evidence: value, classifications: value.classifications };
}

async function runSelfTest() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "browser-evidence-verify-"));
  try {
    const validFile = path.join(tempRoot, "valid.json");
    const acceptedFile = path.join(tempRoot, "accepted.json");
    const noEligibleFile = path.join(tempRoot, "no-eligible.json");
    const regressionFile = path.join(tempRoot, "regression.json");
    const alreadyPresentFile = path.join(tempRoot, "already-present.json");
    const forbiddenFile = path.join(tempRoot, "forbidden.json");
    const unknownFile = path.join(tempRoot, "unknown.json");
    const overlargeFile = path.join(tempRoot, "overlarge.json");

    await writeFile(validFile, `${JSON.stringify(validEvidence({ eligible: true }), null, 2)}\n`);
    await writeFile(acceptedFile, `${JSON.stringify(acceptedEffectEvidence(), null, 2)}\n`);
    await writeFile(noEligibleFile, `${JSON.stringify(validEvidence({ eligible: false }), null, 2)}\n`);
    await writeFile(regressionFile, `${JSON.stringify(recheckOnlyRegressionEvidence(), null, 2)}\n`);
    await writeFile(alreadyPresentFile, `${JSON.stringify(alreadyPresentRegressionEvidence(), null, 2)}\n`);
    await writeFile(forbiddenFile, `${JSON.stringify({ ...validEvidence({ eligible: false }), actionRef: `feed_recheck_v1.${"A".repeat(64)}` })}\n`);
    await writeFile(unknownFile, `${JSON.stringify({ ...validEvidence({ eligible: false }), extra: "unknown" })}\n`);
    await writeFile(overlargeFile, " ".repeat(maxBytes + 1));

    const valid = await verifyEvidenceFile(validFile);
    const accepted = await verifyEvidenceFile(acceptedFile);
    const noEligible = await verifyEvidenceFile(noEligibleFile);
    const stdinEquivalent = verifyEvidenceText(`${JSON.stringify(acceptedEffectEvidence(), null, 2)}\n`);
    const regression = await verifyEvidenceFile(regressionFile, { regressionMode: true, noPriorAcceptanceLedger: false });
    const regressionNoLedger = await verifyEvidenceFile(regressionFile, { regressionMode: true, noPriorAcceptanceLedger: true });
    const alreadyPresent = await verifyEvidenceFile(alreadyPresentFile, { regressionMode: true, noPriorAcceptanceLedger: false });
    const forbidden = await verifyEvidenceFile(forbiddenFile);
    const unknown = await verifyEvidenceFile(unknownFile);
    const overlarge = await verifyEvidenceFile(overlargeFile);

    const failures = [];
    if (valid.status !== "browser-evidence-verify-ok" || !valid.classifications.includes("BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY")) {
      failures.push("valid minimal authenticated evidence was not accepted");
    }
    if (
      accepted.status !== "browser-evidence-verify-ok" ||
      !accepted.classifications.includes("FEED_ONBOARDING_EFFECT_ACCEPTED") ||
      !accepted.classifications.includes("FEED_RECHECK_EFFECT_ACCEPTED")
    ) {
      failures.push("accepted onboarding/recheck effect evidence was not classified");
    }
    if (stdinEquivalent.status !== "browser-evidence-verify-ok" || stdinEquivalent.feed_recheck_effect_status !== "FEED_RECHECK_EFFECT_ACCEPTED") {
      failures.push("stdin-equivalent onboarding/recheck evidence was not classified");
    }
    if (noEligible.status !== "browser-evidence-verify-ok" || !noEligible.classifications.includes("BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET")) {
      failures.push("no-eligible evidence was not classified");
    }
    if (
      regression.status !== "browser-evidence-verify-ok" ||
      regression.feed_onboarding_effect_status !== "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED" ||
      regression.classifications.includes("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON") ||
      !regression.classifications.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK") ||
      !regression.classifications.includes("RECHECK_EFFECT_ACCEPTED_REGRESSION_OK")
    ) {
      failures.push("regression evidence with prior ledger was not classified as non-blocking continuity");
    }
    if (
      regressionNoLedger.status !== "browser-evidence-verify-ok" ||
      regressionNoLedger.feed_onboarding_effect_status !== "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON" ||
      !regressionNoLedger.classifications.includes("OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON") ||
      regressionNoLedger.classifications.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK")
    ) {
      failures.push("regression evidence without prior ledger did not fail closed for onboarding effect");
    }
    if (
      alreadyPresent.status !== "browser-evidence-verify-ok" ||
      alreadyPresent.feed_onboarding_effect_status !== "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE" ||
      !alreadyPresent.classifications.includes("FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK") ||
      alreadyPresent.classifications.includes("FEED_ONBOARDING_EFFECT_ACCEPTED")
    ) {
      failures.push("already-present onboarding evidence was not kept distinct from fresh effect acceptance");
    }
    if (forbidden.classification !== "BROWSER_EVIDENCE_INVALID" || forbidden.reason !== "forbidden_field") {
      failures.push("forbidden actionRef field was not rejected");
    }
    if (unknown.classification !== "BROWSER_EVIDENCE_INVALID" || unknown.reason !== "unknown_field") {
      failures.push("unknown field was not rejected");
    }
    if (overlarge.classification !== "BROWSER_EVIDENCE_INVALID" || overlarge.reason !== "overlarge") {
      failures.push("overlarge body was not rejected");
    }

    if (failures.length > 0) {
      for (const failure of failures) console.error(`browser-evidence-verify: ${failure}`);
      process.exit(1);
    }

    writeJson({
      status: "browser-evidence-verify-self-test-ok",
      cases: [
        "fresh_full_acceptance",
        "regression_prior_ledger",
        "first_time_missing_onboarding_no_ledger",
        "critical_leakage",
        "route_only_effect_pending",
        "recheck_only_regression",
        "stdin_accepted_effect",
        "unknown_field",
        "overlarge"
      ],
      output: "redacted"
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function validEvidence({ eligible }) {
  return {
    schema,
    source: "admin-ui",
    milestone: "MS-027B",
    generatedAt: "2026-07-01T10:00:00.000Z",
    authenticated: true,
    operations: {
      drilldownStatus: "ok",
      drilldownGeneratedAt: "2026-07-01T09:59:00.000Z",
      feeds: {
        total: eligible ? 1 : 0,
        active: eligible ? 1 : 0,
        rows: eligible ? 1 : 0,
        eligibleRecheckTargets: eligible ? 1 : 0,
        noEligibleFeedRecheckTarget: !eligible
      },
      ingestion: {
        rows: 0,
        recentEntryCount: 0,
        recentBatchCount: 0
      }
    },
    feedRecheck: {
      effectStatus: eligible ? "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON" : "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
      lastActionClassification: null
    },
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "available",
      no_eligible_target: !eligible,
      critical_risk: "none",
      effectStatus: "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      lastActionClassification: null
    },
    classifications: eligible
      ? [
          "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
          "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
          "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
          "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET"
        ]
      : [
          "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
          "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
          "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
          "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
          "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET"
        ]
  };
}

function acceptedEffectEvidence() {
  return {
    ...validEvidence({ eligible: true }),
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
}

function recheckOnlyRegressionEvidence() {
  return {
    ...validEvidence({ eligible: true }),
    feedRecheck: {
      effectStatus: "FEED_RECHECK_EFFECT_ACCEPTED",
      lastActionClassification: "FEED_RECHECK_ACTION_ALREADY_PENDING"
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
    ]
  };
}

function alreadyPresentRegressionEvidence() {
  return {
    ...recheckOnlyRegressionEvidence(),
    feedOnboarding: {
      feed_onboarding_available: true,
      feed_onboarding_status: "already_present",
      no_eligible_target: false,
      critical_risk: "none",
      effectStatus: "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
      lastActionClassification: "FEED_ONBOARDING_ACTION_ALREADY_EXISTS"
    },
    classifications: [
      "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
      "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
      "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
      "FEED_RECHECK_EFFECT_ACCEPTED",
      "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED"
    ]
  };
}

function hasPriorMs027bAcceptanceLedger() {
  const docs = [
    readIfExists(path.join(repoRoot, "README.md")),
    readIfExists(path.join(repoRoot, "PRODUCTION.md")),
    readIfExists(path.join(frontendRoot, "README.md")),
    readIfExists(path.join(frontendRoot, "PRODUCTION.md")),
    readIfExists(path.join(frontendRoot, ".docs", "production-feed-effect-acceptance.md")),
    readIfExists(path.join(frontendRoot, ".docs", "operator-risk-model.md")),
    readIfExists(path.join(backendRoot, "README.md")),
    readIfExists(path.join(backendRoot, "PRODUCTION.md"))
  ].join("\n");
  return (
    docs.includes("SUCCESS_MS_027B_R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTANCE_CLOSED_OPERATOR_REPORTED_EVIDENCE_AUTOMATION_LANDED") &&
    docs.includes("MS-027B-R1_FEED_ONBOARDING_RECHECK_EFFECT_PRODUCTION_ACCEPTED_OPERATOR_REPORTED") &&
    docs.includes("FEED_ONBOARDING_EFFECT_ACCEPTED") &&
    docs.includes("FEED_RECHECK_EFFECT_ACCEPTED")
  );
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

async function maybeWriteReceipt(result) {
  if (receiptOut === undefined || receiptOut === "") return;
  const receiptPath = path.resolve(receiptOut);
  const receipt = {
    ...result,
    receipt_sha256: createHash("sha256").update(`${JSON.stringify(result, null, 2)}\n`).digest("hex")
  };
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function isOperationsEvidence(value) {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["drilldownStatus", "drilldownGeneratedAt", "feeds", "ingestion"])) return false;
  return isDrilldownStatus(value.drilldownStatus) && isIso(value.drilldownGeneratedAt) && isFeedsEvidence(value.feeds) && isIngestionEvidence(value.ingestion);
}

function isFeedsEvidence(value) {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["total", "active", "rows", "eligibleRecheckTargets", "noEligibleFeedRecheckTarget"])) return false;
  return isNullableCount(value.total) && isNullableCount(value.active) && isCount(value.rows) && isCount(value.eligibleRecheckTargets) && typeof value.noEligibleFeedRecheckTarget === "boolean";
}

function isIngestionEvidence(value) {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["rows", "recentEntryCount", "recentBatchCount"])) return false;
  return isCount(value.rows) && isNullableCount(value.recentEntryCount) && isNullableCount(value.recentBatchCount);
}

function isFeedRecheckEvidence(value) {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["effectStatus", "lastActionClassification"])) return false;
  const effectStatusAllowed = new Set([
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_OPERATOR_ACTION",
    "FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  ]);
  const actionAllowed = new Set([
    null,
    "FEED_RECHECK_ACTION_ACCEPTED",
    "FEED_RECHECK_ACTION_ALREADY_PENDING",
    "FEED_RECHECK_ACTION_RATE_LIMITED",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION"
  ]);
  return effectStatusAllowed.has(value.effectStatus) && actionAllowed.has(value.lastActionClassification);
}

function isFeedOnboardingEvidence(value) {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "feed_onboarding_available",
      "feed_onboarding_status",
      "no_eligible_target",
      "critical_risk",
      "effectStatus",
      "lastActionClassification"
    ])
  ) {
    return false;
  }
  return (
    value.feed_onboarding_available === true &&
    isFeedOnboardingStatus(value.feed_onboarding_status) &&
    typeof value.no_eligible_target === "boolean" &&
    value.critical_risk === "none" &&
    (value.effectStatus === undefined || isFeedOnboardingEffectStatus(value.effectStatus)) &&
    (value.lastActionClassification === undefined || isFeedOnboardingActionClassification(value.lastActionClassification))
  );
}

function isClassifications(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return false;
  const allowed = new Set([
    "BROWSER_EVIDENCE_ACCEPTED_AUTHENTICATED_READ_ONLY",
    "BROWSER_EVIDENCE_NO_ELIGIBLE_FEED_TARGET",
    "BROWSER_EVIDENCE_FEED_ONBOARDING_AVAILABLE",
    "BROWSER_EVIDENCE_FEED_RECHECK_EFFECT_ACCEPTED_OPERATOR_REPORTED",
    "BROWSER_EVIDENCE_PENDING_ELIGIBLE_FEED_RECHECK_TARGET",
    "FEED_ONBOARDING_EFFECT_ACCEPTED",
    "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED",
    "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE",
    "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK",
    "FEED_RECHECK_EFFECT_ACCEPTED",
    "RECHECK_EFFECT_ACCEPTED_REGRESSION_OK",
    "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING",
    "PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET",
    "PENDING_FEED_RECHECK_COOLDOWN",
    "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION",
    "FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION",
    "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  ]);
  return value.every((classification) => typeof classification === "string" && allowed.has(classification));
}

function isFeedOnboardingStatus(value) {
  return (
    value === "available" ||
    value === "accepted" ||
    value === "already_present" ||
    value === "pending_async_processing" ||
    value === "pending_operator_action" ||
    value === "rejected_safe_validation"
  );
}

function isFeedOnboardingEffectStatus(value) {
  return (
    value === "FEED_ONBOARDING_EFFECT_ACCEPTED" ||
    value === "FEED_ONBOARDING_PREVIOUSLY_ACCEPTED_NOT_RETESTED" ||
    value === "FEED_ONBOARDING_ALREADY_PRESENT_REGRESSION_NOT_APPLICABLE" ||
    value === "FEED_ONBOARDING_ACCEPTANCE_LEDGER_CONTINUITY_OK" ||
    value === "PENDING_FEED_ONBOARDING_ASYNC_PROCESSING" ||
    value === "FEED_ONBOARDING_REJECTED_SAFE_VALIDATION" ||
    value === "OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON"
  );
}

function isFeedOnboardingActionClassification(value) {
  return (
    value === null ||
    value === "FEED_ONBOARDING_ACTION_ACCEPTED" ||
    value === "FEED_ONBOARDING_ACTION_ALREADY_EXISTS" ||
    value === "FEED_ONBOARDING_ACTION_REJECTED_SAFE_VALIDATION"
  );
}

function findForbiddenEvidenceSurface(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findForbiddenEvidenceSurface(item);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && forbiddenStringPattern.test(value)) return "value";
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) return "field";
    const result = findForbiddenEvidenceSurface(nested);
    if (result !== undefined) return result;
  }
  return undefined;
}

function hasOnlyKeys(value, allowed) {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isDrilldownStatus(value) {
  return value === "ok" || value === "partial" || value === "unavailable";
}

function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
}

function isNullableCount(value) {
  return value === null || isCount(value);
}

function isIso(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reason) {
  return {
    status: "browser-evidence-verify-invalid",
    classification: "BROWSER_EVIDENCE_INVALID",
    reason,
    output: "redacted"
  };
}

function invalidValidation(reason) {
  return { valid: false, classification: "BROWSER_EVIDENCE_INVALID", reason };
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function positionalFile() {
  const value = args.find((arg) => !arg.startsWith("--"));
  return value === undefined || value === "true" ? undefined : value;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readStdin(limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > limitBytes) {
        process.stdin.destroy();
        resolve(" ".repeat(limitBytes));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

function fail(message) {
  process.stderr.write(`browser-evidence-verify: ${message}\n`);
  process.exit(1);
}
