import { AgentEntriesModule } from "../../src/agent-entries/agent-entries.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent entries worker boundary", () => {
  it("does not import the entries ingestion module into the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined,
      tenantRateLimit: undefined,
      agentAuth: undefined,
      agentEntries: undefined
    };
    const moduleDefinition = WorkerModule.register(workerConfig);

    expect(moduleDefinition.imports).not.toContain(AgentEntriesModule);
  });
});
