import { AgentFeedCheckResultsModule } from "../../src/agent-feed-check-results/agent-feed-check-results.module";
import { WorkerModule } from "../../src/worker.module";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("Agent feed-check-results worker boundary", () => {
  it("does not import the feed-check-results module into the worker graph", () => {
    const workerConfig = {
      ...runtimeConfig,
      role: "worker" as const,
      tenantAuth: undefined,
      tenantRateLimit: undefined,
      agentAuth: undefined,
      agentEntries: undefined
    };
    const moduleDefinition = WorkerModule.register(workerConfig);

    expect(moduleDefinition.imports).not.toContain(AgentFeedCheckResultsModule);
  });
});
