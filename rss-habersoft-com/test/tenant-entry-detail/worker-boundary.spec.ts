import { TenantEntryDetailModule } from "../../src/tenant-entry-detail/tenant-entry-detail.module";
import { WorkerModule } from "../../src/worker.module";

describe("worker tenant entry detail boundary", () => {
  it("does not import the tenant entry detail module", () => {
    const imports = WorkerModule.register({} as never).imports ?? [];

    expect(imports).not.toContain(TenantEntryDetailModule);
  });
});
