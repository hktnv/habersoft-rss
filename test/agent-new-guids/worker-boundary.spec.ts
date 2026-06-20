import { AgentNewGuidsModule } from "../../src/agent-new-guids/agent-new-guids.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent new GUIDs worker boundary", () => {
  it("does not import the new-GUID module into the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined,
      tenantRateLimit: undefined,
      agentAuth: undefined
    };
    const moduleDefinition = WorkerModule.register(workerConfig);

    expect(moduleDefinition.imports).not.toContain(AgentNewGuidsModule);
  });
});
