import type { NewGuidsResponse } from "./agent-new-guids.types";

export function toNewGuidsResponse(newGuids: readonly string[]): NewGuidsResponse {
  return { new: newGuids };
}
