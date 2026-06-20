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
  REDIS_URL: "redis://redis:6379/0"
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

  it("worker fails fast before Nest bootstrap when config is missing", async () => {
    const createApplicationContext = jest.fn();

    await expect(startWorker({}, { createApplicationContext })).rejects.toBeInstanceOf(
      ConfigValidationError
    );
    expect(createApplicationContext).not.toHaveBeenCalled();
  });
});
