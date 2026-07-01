export const riskModelVersion = "MS-027B_RISK_BALANCED_GUARDRAILS";

export const riskTiers = {
  CRITICAL: [
    "secret credential session cookie CSRF token idempotency key actionRef leakage",
    "browser persistence of auth material",
    "unsafe admin write route or missing CSRF/idempotency on bounded action",
    "unsafe admin feed onboarding route or raw feed URL evidence exposure",
    "feed onboarding or feed recheck action rejected by safe validation",
    "unknown /admin-api/* fallback to HTML",
    "unresolved Nginx template markers or generated config missing exact admin routes",
    "production mutation attempted by Codex",
    "real credential supplied through CLI argument"
  ],
  HIGH: [
    "production upstream unreachable in apply path",
    "frontend backend-network overlay missing for service-DNS upstream",
    "backend auth env not wired for apply",
    "image tag missing for apply plan",
    "route proof unavailable for final operator acceptance",
    "feed onboarding exact route missing from generated Nginx proof"
  ],
  MEDIUM: [
    "optional/defaulted env values missing",
    "host Node/npm mismatch when declared runtime or Docker validation passes",
    "no eligible feed recheck target",
    "feed onboarding accepted but async drilldown/recheck processing is pending",
    "feed recheck target is in bounded cooldown",
    "feed onboarding available but operator action still required",
    "credential-free auth smoke requires browser evidence",
    "operator browser evidence missing"
  ],
  LOW: [
    "npm update notices",
    "CRLF checkout notices that do not alter required blobs",
    "Prisma update notices",
    "non-sensitive generated receipt path"
  ]
};

const classToTier = new Map([
  ["SECRET_OR_AUTH_MATERIAL_EXPOSURE", "CRITICAL"],
  ["BROWSER_AUTH_PERSISTENCE_DETECTED", "CRITICAL"],
  ["ADMIN_API_HTML_FALLBACK_REGRESSION", "CRITICAL"],
  ["ADMIN_WRITE_ROUTE_UNSAFE", "CRITICAL"],
  ["ADMIN_FEED_ONBOARDING_ROUTE_UNSAFE", "CRITICAL"],
  ["FEED_ONBOARDING_RAW_URL_EVIDENCE", "CRITICAL"],
  ["FEED_ONBOARDING_REJECTED_SAFE_VALIDATION", "CRITICAL"],
  ["FEED_RECHECK_ACTION_REJECTED_SAFE_VALIDATION", "CRITICAL"],
  ["MISSING_CSRF_OR_IDEMPOTENCY", "CRITICAL"],
  ["NGINX_TEMPLATE_MARKER_UNRESOLVED", "CRITICAL"],
  ["NGINX_EXACT_ADMIN_ROUTE_MISSING", "CRITICAL"],
  ["PRODUCTION_MUTATION_BY_CODEX", "CRITICAL"],
  ["CLI_CREDENTIAL_REJECTED", "CRITICAL"],
  ["PRODUCTION_UPSTREAM_UNREACHABLE", "HIGH"],
  ["FRONTEND_BACKEND_NETWORK_OVERLAY_MISSING", "HIGH"],
  ["BACKEND_AUTH_ENV_NOT_WIRED", "HIGH"],
  ["IMAGE_TAG_MISSING_FOR_APPLY", "HIGH"],
  ["ROUTE_PROOF_NOT_AVAILABLE", "HIGH"],
  ["FEED_ONBOARDING_ROUTE_PROOF_MISSING", "HIGH"],
  ["OPTIONAL_ENV_DEFAULTED", "MEDIUM"],
  ["HOST_NODE_NPM_VERSION_WARNING", "MEDIUM"],
  ["PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET", "MEDIUM"],
  ["PENDING_FEED_ONBOARDING_ASYNC_PROCESSING", "MEDIUM"],
  ["PENDING_FEED_RECHECK_COOLDOWN", "MEDIUM"],
  ["OPERATOR_ACTION_REQUIRED_WITH_REDACTED_REASON", "MEDIUM"],
  ["FEED_ONBOARDING_EFFECT_ACCEPTED", "LOW"],
  ["FEED_RECHECK_EFFECT_ACCEPTED", "LOW"],
  ["FEED_ONBOARDING_OPERATOR_ACTION_REQUIRED", "MEDIUM"],
  ["AUTHENTICATED_BROWSER_EVIDENCE_REQUIRED", "MEDIUM"],
  ["BROWSER_EVIDENCE_MISSING", "MEDIUM"],
  ["NPM_UPDATE_NOTICE", "LOW"],
  ["CRLF_CHECKOUT_NOTICE", "LOW"],
  ["PRISMA_UPDATE_NOTICE", "LOW"],
  ["RECEIPT_PATH_REDACTED_INFO", "LOW"]
]);

export function classifyRisk(code) {
  return classToTier.get(code) ?? "MEDIUM";
}

export function riskSummary() {
  return {
    version: riskModelVersion,
    tiers: riskTiers,
    rule: "CRITICAL fails closed; HIGH blocks production apply when relevant; MEDIUM is diagnostic; LOW is informational"
  };
}

export function riskClass(code, detail = undefined) {
  return {
    code,
    tier: classifyRisk(code),
    ...(detail === undefined ? {} : { detail })
  };
}
