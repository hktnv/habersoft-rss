import { ConfigValidationError, loadRuntimeConfig } from "../../src/configuration/runtime-config";

const validEnv = {
  APP_ENV: "local",
  LOG_LEVEL: "info",
  RUNTIME_ROLE: "api",
  API_BIND_HOST: "0.0.0.0",
  API_PORT: "3000",
  DATABASE_URL: "postgresql://main_service:password@postgres:5432/main_service?schema=public",
  REDIS_URL: "redis://redis:6379/0"
};

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
      }
    });
  });
});
