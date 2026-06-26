import { ApiModule } from "../../../src/api.module";
import { MaintenanceModule } from "../../../src/maintenance/maintenance.module";
import { WorkerModule } from "../../../src/worker.module";

describe("maintenance worker boundary", () => {
  it("imports maintenance only from the worker graph", () => {
    const apiImports = ApiModule.register({} as never).imports ?? [];
    const workerImports = WorkerModule.register({} as never).imports ?? [];

    expect(apiImports).not.toContain(MaintenanceModule);
    expect(workerImports).toContain(MaintenanceModule);
  });
});
