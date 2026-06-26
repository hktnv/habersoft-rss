import { AgentNewGuidsFeedNotFoundError } from "../../src/agent-new-guids/agent-new-guids.error";
import { FilterAgentNewGuidsUseCase } from "../../src/agent-new-guids/filter-agent-new-guids.use-case";

describe("FilterAgentNewGuidsUseCase", () => {
  it("deduplicates by first occurrence and returns only GUIDs absent from the target feed", async () => {
    const reader = {
      readExistingGuids: jest.fn().mockResolvedValue({ existingGuids: ["existing", "later-existing"] })
    };
    const useCase = new FilterAgentNewGuidsUseCase(reader);

    await expect(
      useCase.execute({
        feedId: 35n,
        guids: ["new-b", "existing", "new-a", "new-b", "later-existing", "new-a"]
      })
    ).resolves.toEqual({ new: ["new-b", "new-a"] });

    expect(reader.readExistingGuids).toHaveBeenCalledTimes(1);
    expect(reader.readExistingGuids).toHaveBeenCalledWith({
      feedId: 35n,
      guids: ["new-b", "existing", "new-a", "later-existing"]
    });
  });

  it("returns an empty success object when every unique GUID already exists", async () => {
    const useCase = new FilterAgentNewGuidsUseCase({
      readExistingGuids: jest.fn().mockResolvedValue({ existingGuids: ["one", "two"] })
    });

    await expect(useCase.execute({ feedId: 1n, guids: ["one", "two", "one"] })).resolves.toEqual({ new: [] });
  });

  it("fails instead of treating an unknown feed as all-new", async () => {
    const useCase = new FilterAgentNewGuidsUseCase({
      readExistingGuids: jest.fn().mockResolvedValue(null)
    });

    await expect(useCase.execute({ feedId: 404n, guids: ["new"] })).rejects.toBeInstanceOf(
      AgentNewGuidsFeedNotFoundError
    );
  });
});
