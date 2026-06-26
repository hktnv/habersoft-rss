import { RuntimeConfigModule } from "../../src/configuration/runtime-config.module";
import { Test } from "@nestjs/testing";
import { AgentKeyVerifier } from "../../src/agent-auth/agent-key.verifier";
import { runtimeConfig } from "../tenant-auth/tenant-auth-test-helpers";

describe("AgentKeyVerifier", () => {
  async function verifierFor(key: string): Promise<AgentKeyVerifier> {
    const moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule.register({ ...runtimeConfig, agentAuth: { key } })],
      providers: [AgentKeyVerifier]
    }).compile();

    return moduleRef.get(AgentKeyVerifier);
  }

  it("verifies only the exact opaque configured value", async () => {
    const verifier = await verifierFor("test_only_agent_key_at_least_32_bytes");

    expect(verifier.verify("test_only_agent_key_at_least_32_bytes")).toBe(true);
    expect(verifier.verify("TEST_ONLY_AGENT_KEY_AT_LEAST_32_BYTES")).toBe(false);
    expect(verifier.verify("test_only_agent_key_at_least_32_bytes ")).toBe(false);
  });

  it("hashes different candidate lengths to a fixed comparison length", async () => {
    const verifier = await verifierFor("test_only_agent_key_at_least_32_bytes");

    expect(verifier.verify("short")).toBe(false);
  });
});
