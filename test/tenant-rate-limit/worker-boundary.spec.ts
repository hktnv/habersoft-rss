import { WorkerModule } from "../../src/worker.module";
import { TenantRateLimitModule } from "../../src/tenant-rate-limit/tenant-rate-limit.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("worker tenant rate-limit boundary", () => {
  it("does not import the tenant rate-limit module", () => {
    const dynamicModule = WorkerModule.register({
      ...runtimeConfig,
      role: "worker",
      tenantAuth: undefined,
      tenantRateLimit: undefined
    });

    expect(dynamicModule.imports).not.toContain(TenantRateLimitModule);
  });
});
