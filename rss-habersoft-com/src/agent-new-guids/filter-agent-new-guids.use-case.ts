import { Inject, Injectable } from "@nestjs/common";
import { AgentNewGuidsFeedNotFoundError } from "./agent-new-guids.error";
import { toNewGuidsResponse } from "./agent-new-guids.mapper";
import { AgentNewGuidsReader } from "./agent-new-guids.reader";
import type { AgentNewGuidsRequest, NewGuidsResponse } from "./agent-new-guids.types";

@Injectable()
export class FilterAgentNewGuidsUseCase {
  public constructor(
    @Inject(AgentNewGuidsReader)
    private readonly reader: Pick<AgentNewGuidsReader, "readExistingGuids">
  ) {}

  public async execute(request: AgentNewGuidsRequest): Promise<NewGuidsResponse> {
    const uniqueGuids = uniqueFirstOccurrence(request.guids);
    const result = await this.reader.readExistingGuids({
      feedId: request.feedId,
      guids: uniqueGuids
    });

    if (result === null) {
      throw new AgentNewGuidsFeedNotFoundError();
    }

    const existing = new Set(result.existingGuids);
    return toNewGuidsResponse(uniqueGuids.filter((guid) => !existing.has(guid)));
  }
}

function uniqueFirstOccurrence(guids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const guid of guids) {
    if (!seen.has(guid)) {
      seen.add(guid);
      unique.push(guid);
    }
  }

  return unique;
}
