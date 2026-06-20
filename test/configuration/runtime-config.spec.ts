import { ConfigValidationError, loadRuntimeConfig } from "../../src/configuration/runtime-config";

const validEnv = {
  APP_ENV: "local",
  LOG_LEVEL: "info",
  RUNTIME_ROLE: "api",
  API_BIND_HOST: "0.0.0.0",
  API_PORT: "3000",
  DATABASE_URL: "postgresql://main_service:password@postgres:5432/main_service?schema=public",
  REDIS_URL: "redis://redis:6379/0",
  TENANT_AUTH_JWKS_URL: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json"
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
      }
    });
  });

  it("requires tenant auth JWKS configuration for the API role", () => {
    expect(() => loadRuntimeConfig(omitTenantAuth(validEnv), "api")).toThrow(ConfigValidationError);
  });

  it("does not require tenant auth JWKS configuration for the worker role", () => {
    const config = loadRuntimeConfig({ ...omitTenantAuth(validEnv), RUNTIME_ROLE: "worker" }, "worker");

    expect(config.tenantAuth).toBeUndefined();
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
});
