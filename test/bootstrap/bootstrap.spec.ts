import { startApi } from "../../src/bootstrap/api-entrypoint";
import { startWorker } from "../../src/bootstrap/worker-entrypoint";
import { ConfigValidationError } from "../../src/configuration/runtime-config";
import { WorkerBootstrapService } from "../../src/worker/worker-bootstrap.service";

const baseEnv = {
  APP_ENV: "local",
  LOG_LEVEL: "info",
  API_BIND_HOST: "0.0.0.0",
  API_PORT: "3000",
  DATABASE_URL: "postgresql://main_service:password@postgres:5432/main_service?schema=public",
  REDIS_URL: "redis://redis:6379/0",
  TENANT_AUTH_JWKS_URL: "http://tenant-auth-jwks-fixture:3080/.well-known/jwks.json",
  TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
  TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
  TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:local",
  TENANT_RATE_LIMIT_KEY_SECRET: "replace_with_local_only_rate_limit_key_secret_32",
  AGENT_KEY: "test_only_agent_key_at_least_32_bytes"
};

describe("bootstrap boundaries", () => {
  it("API entrypoint opens an HTTP listener", async () => {
    const listen = jest.fn<Promise<void>, [number, string]>().mockResolvedValue(undefined);
    const app = {
      enableShutdownHooks: jest.fn(),
      listen
    };
    const create = jest.fn().mockResolvedValue(app);

    await startApi({ ...baseEnv, RUNTIME_ROLE: "api" }, { create });

    expect(create).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(3000, "0.0.0.0");
  });

  it("worker entrypoint starts a Nest context without opening HTTP", async () => {
    const assertInfrastructureReady = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn().mockImplementation((token: unknown) => {
        if (token === WorkerBootstrapService) {
          return { assertInfrastructureReady };
        }
        throw new Error("Unexpected provider");
      }),
      listen: jest.fn()
    };
    const createApplicationContext = jest.fn().mockResolvedValue(app);

    await startWorker({ ...baseEnv, RUNTIME_ROLE: "worker" }, { createApplicationContext });

    expect(createApplicationContext).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(assertInfrastructureReady).toHaveBeenCalledTimes(1);
    expect(app.listen).not.toHaveBeenCalled();
  });

  it("API fails fast before Nest bootstrap when config is missing", async () => {
    const create = jest.fn();

    await expect(startApi({}, { create })).rejects.toBeInstanceOf(ConfigValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it("API fails fast before Nest bootstrap when agent key config is missing", async () => {
    const create = jest.fn();

    await expect(startApi({ ...baseEnv, RUNTIME_ROLE: "api", AGENT_KEY: undefined }, { create })).rejects.toBeInstanceOf(
      ConfigValidationError
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("worker does not require agent key config", async () => {
    const assertInfrastructureReady = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn().mockImplementation((token: unknown) => {
        if (token === WorkerBootstrapService) {
          return { assertInfrastructureReady };
        }
        throw new Error("Unexpected provider");
      })
    };
    const createApplicationContext = jest.fn().mockResolvedValue(app);

    await startWorker({ ...baseEnv, RUNTIME_ROLE: "worker", AGENT_KEY: undefined }, { createApplicationContext });

    expect(createApplicationContext).toHaveBeenCalledTimes(1);
  });

  it("worker fails fast before Nest bootstrap when config is missing", async () => {
    const createApplicationContext = jest.fn();

    await expect(startWorker({}, { createApplicationContext })).rejects.toBeInstanceOf(
      ConfigValidationError
    );
    expect(createApplicationContext).not.toHaveBeenCalled();
  });
});
