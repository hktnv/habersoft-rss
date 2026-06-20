import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import { AGENT_PRINCIPAL_REQUEST_KEY } from "../agent-auth/agent-auth.constants";
import type { AgentAuthenticatedRequest, AgentPrincipal } from "../agent-auth/agent-auth.types";
import { AgentKeyAuthGuard } from "../agent-auth/agent-key-auth.guard";
import type { DueFeedResponse } from "./agent-due-feeds.types";
import { validateAgentDueFeedsQuery } from "./agent-due-feeds.validation";
import { ListAgentDueFeedsUseCase } from "./list-agent-due-feeds.use-case";

@Controller("agent/feeds/due")
@UseGuards(AgentKeyAuthGuard)
export class AgentDueFeedsController {
  public constructor(private readonly listDueFeeds: ListAgentDueFeedsUseCase) {}

  @Get()
  public async list(@Req() request: AgentAuthenticatedRequest, @Query() query: unknown): Promise<DueFeedResponse> {
    const validated = validateAgentDueFeedsQuery(query);
    if (!validated.ok) {
      throw validationError();
    }

    requirePrincipal(request);
    return this.listDueFeeds.execute(validated.value);
  }
}

function requirePrincipal(request: AgentAuthenticatedRequest): AgentPrincipal {
  const principal = request[AGENT_PRINCIPAL_REQUEST_KEY];
  if (principal === undefined) {
    throw new InternalServerErrorException();
  }

  return principal;
}

function validationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({ error_code: "VALIDATION_FAILED" });
}
