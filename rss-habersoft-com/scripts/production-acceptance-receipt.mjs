import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const APPLICATION_STATUS = "MVP — Production Aktif";
const DEFAULT_RECEIPT = path.resolve("..", "operator-state", "ms-018c", "production-acceptance-receipt.json");
const NOT_RECORDED_FIELDS = [
  "production_git_commit",
  "production_image_id",
  "production_image_revision_label",
  "worker_health",
  "scheduler_inventory",
  "production_backup_sha256",
  "production_restore_verification",
  "tls_fingerprint",
  "tls_expiry",
  "current_previous_pointers",
  "restart_oom_stability"
];

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "verify";

if (command === "generate") {
  const output = path.resolve(args.output ?? DEFAULT_RECEIPT);
  assertOutsideRepository(output);
  const receipt = createReceipt();
  validateReceipt(receipt);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  const digest = sha256(readFileSync(output));
  console.log(`production-acceptance-receipt: generated ${output}`);
  console.log(`sha256=${digest}`);
} else if (command === "verify") {
  const receiptFile = path.resolve(args.receipt ?? DEFAULT_RECEIPT);
  const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
  validateReceipt(receipt);
  const digest = sha256(readFileSync(receiptFile));
  console.log("production-acceptance-receipt: ok");
  console.log(`sha256=${digest}`);
} else {
  fail(`unknown command: ${command}`);
}

function createReceipt() {
  return {
    schema_version: 1,
    milestone: "MS-018C",
    service: "main-service",
    environment: "production",
    application_version: "0.1.0-ms-017",
    operator_evidence_date: "2026-06-22",
    generated_at_utc: new Date().toISOString(),
    evidence_source: "operator-confirmed transcript",
    application_status: APPLICATION_STATUS,
    basic_activation_acceptance: "PASSED",
    full_operational_acceptance: "PARTIAL_NOT_FULLY_RECORDED",
    internal_live: {
      result: "PASSED",
      method: "GET",
      url: "http://127.0.0.1:3200/health/live",
      http_status: 200,
      response_status: "live"
    },
    internal_ready: {
      result: "PASSED",
      method: "GET",
      url: "http://127.0.0.1:3200/health/ready",
      http_status: 200,
      response_status: "ready"
    },
    public_live: {
      result: "PASSED",
      method: "GET",
      url: "https://rss.habersoft.com/health/live",
      http_status: 200,
      response_status: "live"
    },
    public_ready: {
      result: "PASSED",
      method: "GET",
      url: "https://rss.habersoft.com/health/ready",
      http_status: 200,
      response_status: "ready"
    },
    dependencies: {
      postgres: "up",
      redis: "up",
      tenantAuth: "up"
    },
    api_loopback_upstream: "127.0.0.1:3200",
    production_git_commit: "NOT_RECORDED",
    production_image_id: "NOT_RECORDED",
    production_image_revision_label: "NOT_RECORDED",
    worker_health: "NOT_RECORDED",
    scheduler_inventory: "NOT_RECORDED",
    production_backup_sha256: "NOT_RECORDED",
    production_restore_verification: "NOT_RECORDED",
    tls_fingerprint: "NOT_RECORDED",
    tls_expiry: "NOT_RECORDED",
    current_previous_pointers: "NOT_RECORDED",
    restart_oom_stability: "NOT_RECORDED",
    artifact_publication: "NOT_PERFORMED",
    git_tag: "NOT_CREATED",
    github_release: "NOT_CREATED",
    independent_agent_application: "NOT_IMPLEMENTED_OR_SEPARATE_DELIVERY",
    independent_tenant_applications: "SEPARATE_DELIVERY",
    rss_panel_frontend: "NOT_IMPLEMENTED_INACTIVE",
    public_recheck: {
      status: "NOT_RUN",
      reason: "operator-confirmed evidence is authoritative for MS-018C"
    }
  };
}

function validateReceipt(receipt) {
  assert(receipt.schema_version === 1, "schema_version must be 1");
  assert(receipt.milestone === "MS-018C", "milestone mismatch");
  assert(receipt.service === "main-service", "service mismatch");
  assert(receipt.environment === "production", "environment mismatch");
  assert(receipt.application_version === "0.1.0-ms-017", "application_version mismatch");
  assert(receipt.operator_evidence_date === "2026-06-22", "operator_evidence_date mismatch");
  assert(isIsoDateTime(receipt.generated_at_utc), "generated_at_utc must be ISO timestamp");
  assert(receipt.evidence_source === "operator-confirmed transcript", "evidence_source mismatch");
  assert(receipt.application_status === APPLICATION_STATUS, "application_status mismatch");
  assert(receipt.basic_activation_acceptance === "PASSED", "basic activation must be PASSED");
  assert(receipt.full_operational_acceptance === "PARTIAL_NOT_FULLY_RECORDED", "full acceptance must be partial");
  assertEndpoint(receipt.internal_live, "http://127.0.0.1:3200/health/live", "live");
  assertEndpoint(receipt.internal_ready, "http://127.0.0.1:3200/health/ready", "ready");
  assertEndpoint(receipt.public_live, "https://rss.habersoft.com/health/live", "live");
  assertEndpoint(receipt.public_ready, "https://rss.habersoft.com/health/ready", "ready");
  assert(receipt.dependencies?.postgres === "up", "postgres dependency mismatch");
  assert(receipt.dependencies?.redis === "up", "redis dependency mismatch");
  assert(receipt.dependencies?.tenantAuth === "up", "tenantAuth dependency mismatch");
  assert(receipt.api_loopback_upstream === "127.0.0.1:3200", "loopback upstream mismatch");
  for (const field of NOT_RECORDED_FIELDS) {
    assert(receipt[field] === "NOT_RECORDED", `${field} must be NOT_RECORDED`);
  }
  assert(receipt.artifact_publication === "NOT_PERFORMED", "artifact publication mismatch");
  assert(receipt.git_tag === "NOT_CREATED", "git_tag mismatch");
  assert(receipt.github_release === "NOT_CREATED", "github_release mismatch");
  assert(receipt.independent_agent_application === "NOT_IMPLEMENTED_OR_SEPARATE_DELIVERY", "agent app boundary mismatch");
  assert(receipt.independent_tenant_applications === "SEPARATE_DELIVERY", "tenant app boundary mismatch");
  assert(receipt.rss_panel_frontend === "NOT_IMPLEMENTED_INACTIVE", "rss panel boundary mismatch");
  assertNoForbiddenValues(receipt);
}

function assertEndpoint(value, url, status) {
  assert(value?.result === "PASSED", `${url} result must be PASSED`);
  assert(value?.method === "GET", `${url} method must be GET`);
  assert(value?.url === url, `${url} url mismatch`);
  assert(value?.http_status === 200, `${url} HTTP status mismatch`);
  assert(value?.response_status === status, `${url} response status mismatch`);
}

function assertNoForbiddenValues(value, trail = "") {
  if (typeof value === "string") {
    assert(!/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/u.test(value), `private key marker at ${trail}`);
    assert(!/Bearer [A-Za-z0-9._-]+/u.test(value), `bearer token at ${trail}`);
    assert(!/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/iu.test(value), `database credential URL at ${trail}`);
    assert(!/(?:^|[\s`"'(<])(?:[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp)\/)/u.test(value), `local/private path at ${trail}`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenValues(entry, `${trail}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assert(!/(password|secret|token|credential|private|database_url|agent_key)/iu.test(key), `forbidden field ${trail}.${key}`);
      assertNoForbiddenValues(nested, trail === "" ? key : `${trail}.${key}`);
    }
  }
}

function assertOutsideRepository(file) {
  const root = `${process.cwd()}${path.sep}`;
  const target = path.resolve(file);
  if (target === process.cwd() || target.startsWith(root)) {
    fail("receipt output must be outside the application repository");
  }
}

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    parsed[key] = next === undefined || next.startsWith("--") ? "true" : next;
    if (parsed[key] !== "true") {
      index += 1;
    }
  }
  return parsed;
}

function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.endsWith("Z");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function fail(message) {
  console.error(`production-acceptance-receipt: ${message}`);
  process.exit(1);
}
