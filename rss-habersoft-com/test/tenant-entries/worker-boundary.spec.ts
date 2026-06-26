import { TenantEntriesModule } from "../../src/tenant-entries/tenant-entries.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("worker tenant entries boundary", () => {
  it("does not import the tenant entries module", () => {
    const dynamicModule = WorkerModule.register({
      ...runtimeConfig,
      role: "worker",
      tenantAuth: undefined,
      tenantRateLimit: undefined
    });

    expect(dynamicModule.imports).not.toContain(TenantEntriesModule);
  });
});
