import {
  ConfigValidationError,
  loadRuntimeConfig,
  localAgentKeyPlaceholder
} from "../../src/configuration/runtime-config";

const validEnv = {
  APP_ENV: "local",
  LOG_LEVEL: "info",
  RUNTIME_ROLE: "api",
  API_BIND_HOST: "0.0.0.0",
  API_PORT: "3000",
  DATABASE_URL: "postgresql://main_service:password@postgres:5432/main_service?schema=public",
  REDIS_URL: "redis://redis:6379/0",
  TENANT_AUTH_JWKS_URL: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json",
  TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
  TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
  TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:local",
  TENANT_RATE_LIMIT_KEY_SECRET: "replace_with_local_only_rate_limit_key_secret_32",
  AGENT_KEY: localAgentKeyPlaceholder
};

function omitTenantAuth(env: typeof validEnv): Record<string, string | undefined> {
  return {
    ...env,
    TENANT_AUTH_JWKS_URL: undefined
  };
}

describe("loadRuntimeConfig", () => {
  it("fails when required values are missing", () => {
    expect(() => loadRuntimeConfig({}, "api")).toThrow(ConfigValidationError);
  });

  it("fails when port or URL values are invalid", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          API_PORT: "70000",
          DATABASE_URL: "not-a-url"
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });

  it("fails when runtime role does not match the entrypoint", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, RUNTIME_ROLE: "worker" }, "api")).toThrow(
      ConfigValidationError
    );
  });

  it("returns a valid configuration", () => {
    const config = loadRuntimeConfig(validEnv, "api");

    expect(config).toEqual({
      role: "api",
      environment: "local",
      logLevel: "info",
      api: {
        host: "0.0.0.0",
        port: 3000
      },
      postgres: {
        url: validEnv.DATABASE_URL
      },
      redis: {
        url: validEnv.REDIS_URL
      },
      tenantAuth: {
        jwksUrl: validEnv.TENANT_AUTH_JWKS_URL,
        issuer: "https://auth.habersoft.com",
        audience: "rss.habersoft.com",
        requiredScope: "services:access",
        algorithm: "RS256",
        clockToleranceSeconds: 30,
        refreshIntervalMs: 300000,
        httpTimeoutMs: 2000,
        maxResponseBytes: 65536
      },
      tenantRateLimit: {
        maxRequests: 60,
        windowSeconds: 60,
        redisPrefix: "tenant_rate_limit:local",
        keySecret: "replace_with_local_only_rate_limit_key_secret_32"
      },
      agentAuth: {
        key: localAgentKeyPlaceholder
      }
    });
  });

  it("requires tenant auth JWKS configuration for the API role", () => {
    expect(() => loadRuntimeConfig(omitTenantAuth(validEnv), "api")).toThrow(ConfigValidationError);
  });

  it("does not require tenant auth JWKS configuration for the worker role", () => {
    const config = loadRuntimeConfig({ ...omitTenantAuth(validEnv), RUNTIME_ROLE: "worker" }, "worker");

    expect(config.tenantAuth).toBeUndefined();
    expect(config.tenantRateLimit).toBeUndefined();
    expect(config.agentAuth).toBeUndefined();
  });

  it("rejects local or non-HTTPS JWKS URLs in production", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          APP_ENV: "production",
          TENANT_AUTH_JWKS_URL: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json"
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });

  it("requires tenant rate-limit configuration for the API role", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          TENANT_RATE_LIMIT_MAX_REQUESTS: undefined
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });

  it("rejects invalid tenant rate-limit values", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          TENANT_RATE_LIMIT_MAX_REQUESTS: "0",
          TENANT_RATE_LIMIT_REDIS_PREFIX: "Tenant Rate Limit"
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });

  it("rejects local tenant rate-limit secrets in production", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          APP_ENV: "production",
          TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json",
          TENANT_RATE_LIMIT_KEY_SECRET: "replace_with_local_only_rate_limit_key_secret_32"
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });

  it("requires agent auth configuration for the API role", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, AGENT_KEY: undefined }, "api")).toThrow(
      ConfigValidationError
    );
  });

  it("rejects invalid agent keys without echoing the value", () => {
    const secretWithControl = "test_only_agent_key_at_least_32_bytes\n";

    try {
      loadRuntimeConfig({ ...validEnv, AGENT_KEY: secretWithControl }, "api");
      throw new Error("Expected loadRuntimeConfig to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as Error).message).toContain("AGENT_KEY");
      expect((error as Error).message).not.toContain(secretWithControl);
    }
  });

  it("rejects short or whitespace-padded agent keys", () => {
    expect(() => loadRuntimeConfig({ ...validEnv, AGENT_KEY: "too-short" }, "api")).toThrow(
      ConfigValidationError
    );
    expect(() =>
      loadRuntimeConfig({ ...validEnv, AGENT_KEY: " test_only_agent_key_at_least_32_bytes " }, "api")
    ).toThrow(ConfigValidationError);
  });

  it("accepts agent keys that are at least 32 UTF-8 bytes", () => {
    const config = loadRuntimeConfig({ ...validEnv, AGENT_KEY: "ç".repeat(16) }, "api");

    expect(config.agentAuth).toEqual({ key: "ç".repeat(16) });
  });

  it("rejects local agent key placeholders in production", () => {
    expect(() =>
      loadRuntimeConfig(
        {
          ...validEnv,
          APP_ENV: "production",
          TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json",
          TENANT_RATE_LIMIT_KEY_SECRET: "production_rate_limit_key_secret_32",
          AGENT_KEY: localAgentKeyPlaceholder
        },
        "api"
      )
    ).toThrow(ConfigValidationError);
  });
});
