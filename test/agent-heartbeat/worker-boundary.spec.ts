import { AgentHeartbeatModule } from "../../src/agent-heartbeat/agent-heartbeat.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent heartbeat worker boundary", () => {
  it("does not import the heartbeat module into the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined,
      tenantRateLimit: undefined,
      agentAuth: undefined
    };
    const moduleDefinition = WorkerModule.register(workerConfig);

    expect(moduleDefinition.imports).not.toContain(AgentHeartbeatModule);
  });
});
