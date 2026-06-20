import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";
import { TenantFeedsModule } from "../../src/tenant-feeds/tenant-feeds.module";
import { WorkerModule } from "../../src/worker.module";

describe("tenant feeds module boundary", () => {
  it("is not imported by the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined
    };
    const dynamicModule = WorkerModule.register(workerConfig);

    expect(dynamicModule.imports).not.toContain(TenantFeedsModule);
    expect(dynamicModule.providers).toHaveLength(1);
  });
});
