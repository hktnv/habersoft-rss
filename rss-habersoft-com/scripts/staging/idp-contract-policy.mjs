import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const CONTRACT_ERROR_CODES = Object.freeze({
  required: "STAGING_IDP_CONTRACT_REQUIRED",
  notFound: "STAGING_IDP_CONTRACT_NOT_FOUND",
  notRegularFile: "STAGING_IDP_CONTRACT_NOT_REGULAR_FILE",
  hashMismatch: "STAGING_IDP_CONTRACT_HASH_MISMATCH",
  fieldMismatch: "STAGING_IDP_CONTRACT_FIELD_MISMATCH",
  decisionMismatch: "STAGING_IDP_CONTRACT_DECISION_MISMATCH",
  consumerMismatch: "STAGING_IDP_CONTRACT_CONSUMER_MISMATCH",
  jwksMismatch: "STAGING_IDP_JWKS_URL_MISMATCH",
  productionIdentifierForbidden: "STAGING_PRODUCTION_IDENTIFIER_FORBIDDEN"
});

export const DEFAULT_IDP_CONTRACT_POLICY_FILE = "deploy/staging/idp-contract-policy.json";
const maxContractBytes = 64 * 1024;
const markdownTitle = "STAGING YETK\u0130LEND\u0130RME ENTEGRASYON S\u00d6ZLE\u015eMES\u0130";

export function loadIdpContractPolicy(policyFile = DEFAULT_IDP_CONTRACT_POLICY_FILE) {
  const policy = JSON.parse(readFileSync(path.resolve(policyFile), "utf8"));
  assert(policy.schema_version === 1, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.decision === "STAGING_USES_PRODUCTION_IDP", CONTRACT_ERROR_CODES.decisionMismatch);
  assert(policy.environment === "staging", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.consumer === "main-service", CONTRACT_ERROR_CODES.consumerMismatch);
  assert(policy.status === "ONAYLANDI & AKT\u0130F", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.issuer === "https://auth.habersoft.com", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.jwks_url === "https://auth.habersoft.com/.well-known/jwks.json", CONTRACT_ERROR_CODES.jwksMismatch);
  assert(policy.audience === "rss.habersoft.com", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.scope === "services:access", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.algorithm === "RS256", CONTRACT_ERROR_CODES.fieldMismatch);
  assert(policy.raw_sha256 === "ba83f81e86502c93b5f54e5b50bc178df295305ecd840d51d6a1a0f8da7935aa", CONTRACT_ERROR_CODES.hashMismatch);
  assert(policy.lf_normalized_sha256 === "e8c3746dd58b1ba511c6a3c09eac574fa0a73017fca7524ae8657ac4b6839a60", CONTRACT_ERROR_CODES.hashMismatch);
  assert(policy.authorization_scope === "staging-readiness-and-validation", CONTRACT_ERROR_CODES.fieldMismatch);
  return Object.freeze({ ...policy });
}

export function resolveIdpContractFile(options = {}) {
  return options.idpContractFile ?? process.env.STAGING_IDP_CONTRACT_FILE;
}

export function loadVerifiedStagingIdpContract(options = {}) {
  const policy = loadIdpContractPolicy(options.policyFile);
  const contractFile = resolveIdpContractFile(options);
  if (contractFile === undefined || String(contractFile).trim() === "") {
    throw new Error(CONTRACT_ERROR_CODES.required);
  }

  const resolved = path.resolve(contractFile);
  if (!existsSync(resolved)) {
    throw new Error(CONTRACT_ERROR_CODES.notFound);
  }

  const linkStat = lstatSync(resolved);
  if (linkStat.isSymbolicLink()) {
    throw new Error(CONTRACT_ERROR_CODES.notRegularFile);
  }

  const stat = statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxContractBytes) {
    throw new Error(CONTRACT_ERROR_CODES.notRegularFile);
  }

  assertContractNotTracked(resolved, options.repoRoot ?? process.cwd());

  let raw;
  try {
    raw = readFileSync(resolved);
  } catch {
    throw new Error(CONTRACT_ERROR_CODES.notRegularFile);
  }
  const text = raw.toString("utf8");
  if (text.includes("\uFFFD")) {
    throw new Error(CONTRACT_ERROR_CODES.fieldMismatch);
  }

  const rawSha256 = sha256(raw);
  const normalizedText = text.replace(/\r\n/gu, "\n");
  const normalizedSha256 = sha256(normalizedText);
  const rawHashMatch = rawSha256 === policy.raw_sha256;
  const normalizedHashMatch = normalizedSha256 === policy.lf_normalized_sha256;
  if (!rawHashMatch && !normalizedHashMatch) {
    throw new Error(CONTRACT_ERROR_CODES.hashMismatch);
  }

  const parsed = parseContractMarkdown(text);
  assert(parsed.title === markdownTitle, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.owner === policy.owner, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.environment === policy.environment, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.consumer === policy.consumer, CONTRACT_ERROR_CODES.consumerMismatch);
  assert(parsed.status === policy.status, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.decision === policy.decision, CONTRACT_ERROR_CODES.decisionMismatch);
  assert(parsed.issuer === policy.issuer, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.jwksUrl === policy.jwks_url, CONTRACT_ERROR_CODES.jwksMismatch);
  assert(parsed.audience === policy.audience, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.scope === policy.scope, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.algorithm === policy.algorithm, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.tokenAcquisitionOwner === policy.token_acquisition_owner, CONTRACT_ERROR_CODES.fieldMismatch);
  assert(parsed.authorizationStatementPresent === true, CONTRACT_ERROR_CODES.fieldMismatch);

  return Object.freeze({
    contract_present: true,
    contract_verified: true,
    decision: policy.decision,
    owner: policy.owner,
    environment: policy.environment,
    consumer: policy.consumer,
    status: policy.status,
    issuer: policy.issuer,
    jwks_url: policy.jwks_url,
    audience: policy.audience,
    scope: policy.scope,
    algorithm: policy.algorithm,
    token_acquisition_owner: policy.token_acquisition_owner,
    raw_sha256: rawSha256,
    lf_normalized_sha256: normalizedSha256,
    raw_hash_match: rawHashMatch,
    normalized_hash_match: normalizedHashMatch,
    authorization_scope: policy.authorization_scope,
    external_contract_path_recorded: false
  });
}

export function optionalContractProjection(contract) {
  if (contract === undefined) {
    return {
      contract_present: false,
      contract_verified: false,
      decision: null,
      owner: null,
      environment: null,
      consumer: null,
      status: null,
      issuer: null,
      jwks_url: null,
      audience: null,
      scope: null,
      algorithm: null,
      token_acquisition_owner: null,
      raw_sha256: null,
      lf_normalized_sha256: null,
      raw_hash_match: false,
      normalized_hash_match: false,
      authorization_scope: null
    };
  }

  return {
    contract_present: contract.contract_present === true,
    contract_verified: contract.contract_verified === true,
    decision: contract.decision,
    owner: contract.owner,
    environment: contract.environment,
    consumer: contract.consumer,
    status: contract.status,
    issuer: contract.issuer,
    jwks_url: contract.jwks_url,
    audience: contract.audience,
    scope: contract.scope,
    algorithm: contract.algorithm,
    token_acquisition_owner: contract.token_acquisition_owner,
    raw_sha256: contract.raw_sha256,
    lf_normalized_sha256: contract.lf_normalized_sha256,
    raw_hash_match: contract.raw_hash_match,
    normalized_hash_match: contract.normalized_hash_match,
    authorization_scope: contract.authorization_scope
  };
}

function parseContractMarkdown(text) {
  return {
    title: parseTitle(text),
    owner: parseLineValue(text, "S\u00f6zle\u015fme Sahibi"),
    environment: parseLineValue(text, "Ortam Ad\u0131"),
    consumer: parseLineValue(text, "Onaylanm\u0131\u015f Kaynak Sunucusu T\u00fcketicileri"),
    status: parseLineValue(text, "Durum"),
    decision: parseLineValue(text, "Karar"),
    issuer: parseLineValue(text, "Yay\u0131nc\u0131 (Issuer)"),
    jwksUrl: parseLineValue(text, "JWKS HTTPS URL"),
    audience: parseLineValue(text, "Al\u0131c\u0131 (Audience)"),
    scope: parseLineValue(text, "Kapsam (Scope)"),
    algorithm: parseLineValue(text, "JWT Algoritma \u0130zin Listesi"),
    tokenAcquisitionOwner: parseLineValue(text, "Token Alma Sahibi"),
    authorizationStatementPresent:
      text.includes("main-service staging") &&
      text.includes("readiness") &&
      text.includes("do\u011frulama") &&
      text.includes("https://auth.habersoft.com") &&
      text.includes("a\u00e7\u0131k\u00e7a onaylamaktad\u0131r")
  };
}

function parseTitle(text) {
  const match = /^#\s+(.+?)\s*$/mu.exec(text);
  return match?.[1]?.trim() ?? "";
}

function parseLineValue(text, label) {
  const escaped = escapeRegExp(label);
  const match = new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, "mu").exec(text);
  return match?.[1]?.trim() ?? "";
}

function assertContractNotTracked(file, repoRoot) {
  const root = realpathSync(path.resolve(repoRoot));
  const resolved = realpathSync(file);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) {
      throw new Error(CONTRACT_ERROR_CODES.fieldMismatch);
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, code) {
  if (!condition) {
    throw new Error(code);
  }
}
