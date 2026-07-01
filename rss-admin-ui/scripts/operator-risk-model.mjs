export const riskModelVersion = "MS-026C_RISK_BALANCED_GUARDRAILS";

export const riskTiers = {
  CRITICAL: [
    "secret credential session cookie CSRF token idempotency key actionRef leakage",
    "browser persistence of auth material",
    "unsafe admin write route or missing CSRF/idempotency on bounded action",
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
    "route proof unavailable for final operator acceptance"
  ],
  MEDIUM: [
    "optional/defaulted env values missing",
    "host Node/npm mismatch when declared runtime or Docker validation passes",
    "no eligible feed recheck target",
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
  ["OPTIONAL_ENV_DEFAULTED", "MEDIUM"],
  ["HOST_NODE_NPM_VERSION_WARNING", "MEDIUM"],
  ["PENDING_NO_ELIGIBLE_FEED_RECHECK_TARGET", "MEDIUM"],
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
