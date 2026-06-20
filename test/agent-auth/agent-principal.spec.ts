import { createAgentPrincipal } from "../../src/agent-auth/agent-principal";

describe("createAgentPrincipal", () => {
  it("creates an immutable default agent principal without secret material", () => {
    const principal = createAgentPrincipal();

    expect(principal).toEqual({ agentId: "default" });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(principal).not.toHaveProperty("key");
    expect(principal).not.toHaveProperty("digest");
    expect(principal).not.toHaveProperty("fingerprint");
  });
});
