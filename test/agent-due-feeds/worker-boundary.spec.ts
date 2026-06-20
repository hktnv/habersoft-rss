import { AgentDueFeedsModule } from "../../src/agent-due-feeds/agent-due-feeds.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent due feeds worker boundary", () => {
  it("does not import the due-feed module into the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined,
      tenantRateLimit: undefined,
      agentAuth: undefined
    };
    const moduleDefinition = WorkerModule.register(workerConfig);

    expect(moduleDefinition.imports).not.toContain(AgentDueFeedsModule);
  });
});
