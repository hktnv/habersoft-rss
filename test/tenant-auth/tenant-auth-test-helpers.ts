import { createSign, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { JWK, JWTPayload } from "jose";
import type {
  AgentAuthConfig,
  AgentEntriesConfig,
  RuntimeConfig,
  TenantAuthConfig,
  TenantRateLimitConfig
} from "../../src/configuration/runtime-config";

export const tenantAuthConfig: TenantAuthConfig = {
  jwksUrl: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json",
  issuer: "https://auth.habersoft.com",
  audience: "rss.habersoft.com",
  requiredScope: "services:access",
  algorithm: "RS256",
  clockToleranceSeconds: 30,
  refreshIntervalMs: 300000,
  httpTimeoutMs: 2000,
  maxResponseBytes: 65536
};

export const tenantRateLimitConfig: TenantRateLimitConfig = {
  maxRequests: 60,
  windowSeconds: 60,
  redisPrefix: "tenant_rate_limit:test",
  keySecret: "test_only_tenant_rate_limit_key_secret_32"
};

export const agentAuthConfig: AgentAuthConfig = {
  key: "test_only_agent_key_at_least_32_bytes"
};

export const agentEntriesConfig: AgentEntriesConfig = {
  checkedAtMaxFutureSkewSeconds: 60,
  checkedAtMaxAgeSeconds: 900
};

export const runtimeConfig: RuntimeConfig = {
  role: "api",
  environment: "test",
  logLevel: "error",
  api: {
    host: "127.0.0.1",
    port: 3000
  },
  postgres: {
    url: "postgresql://main_service:password@postgres:5432/main_service?schema=public"
  },
  redis: {
    url: "redis://redis:6379/0"
  },
  tenantAuth: tenantAuthConfig,
  tenantRateLimit: tenantRateLimitConfig,
  agentAuth: agentAuthConfig,
  agentEntries: agentEntriesConfig
};

export type TestKeyPair = {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly publicJwk: JWK;
};

export function generateTestKeyPair(kid: string): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001
  });
  const exported = publicKey.export({ format: "jwk" }) as JWK;

  return {
    kid,
    privateKey,
    publicJwk: {
      ...exported,
      kid,
      use: "sig",
      alg: "RS256"
    }
  };
}

export type TenantTokenOptions = {
  readonly key: TestKeyPair;
  readonly subject?: string | null;
  readonly clientId?: string | null;
  readonly scope?: string | null;
  readonly audience?: string | string[];
  readonly issuer?: string;
  readonly expiresIn?: string;
  readonly extraPayload?: JWTPayload;
};

export function signTenantToken(options: TenantTokenOptions): string {
  const subject = options.subject === undefined ? "site-a" : options.subject;
  const clientId = options.clientId === undefined ? subject : options.clientId;
  const scope = options.scope === undefined ? "services:access other:scope" : options.scope;
  const payload: JWTPayload = {
    ...options.extraPayload,
    iss: options.issuer ?? tenantAuthConfig.issuer,
    aud: options.audience ?? [tenantAuthConfig.audience],
    iat: nowInSeconds(),
    exp: nowInSeconds() + expirationSeconds(options.expiresIn ?? "2h")
  };

  if (clientId !== null) {
    payload.client_id = clientId;
  }

  if (scope !== null) {
    payload.scope = scope;
  }

  if (subject !== null) {
    payload.sub = subject;
  }

  const header = {
    alg: "RS256",
    kid: options.key.kid,
    typ: "JWT"
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(options.key.privateKey);

  return `${signingInput}.${signature.toString("base64url")}`;
}

export function jwks(keys: readonly TestKeyPair[]): { readonly keys: readonly JWK[] } {
  return {
    keys: keys.map((key) => key.publicJwk)
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expirationSeconds(value: string): number {
  if (value.endsWith("h")) {
    return Number(value.slice(0, -1)) * 60 * 60;
  }

  return Number(value);
}
