import { toNewGuidsResponse } from "../../src/agent-new-guids/agent-new-guids.mapper";

describe("toNewGuidsResponse", () => {
  it("projects only the canonical new array", () => {
    expect(toNewGuidsResponse(["b", "a"])).toEqual({ new: ["b", "a"] });
  });
});
