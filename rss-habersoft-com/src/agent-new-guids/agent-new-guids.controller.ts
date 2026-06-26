import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import { AGENT_PRINCIPAL_REQUEST_KEY } from "../agent-auth/agent-auth.constants";
import type { AgentAuthenticatedRequest, AgentPrincipal } from "../agent-auth/agent-auth.types";
import { AgentKeyAuthGuard } from "../agent-auth/agent-key-auth.guard";
import { AgentNewGuidsFeedNotFoundError } from "./agent-new-guids.error";
import type { NewGuidsResponse } from "./agent-new-guids.types";
import { validateAgentNewGuidsRequest } from "./agent-new-guids.validation";
import { FilterAgentNewGuidsUseCase } from "./filter-agent-new-guids.use-case";

@Controller("agent/feeds")
@UseGuards(AgentKeyAuthGuard)
export class AgentNewGuidsController {
  public constructor(private readonly filterNewGuids: FilterAgentNewGuidsUseCase) {}

  @Post(":feed_id/new-guids")
  @HttpCode(200)
  public async filter(
    @Req() request: AgentAuthenticatedRequest,
    @Param("feed_id") feedId: unknown,
    @Body() body: unknown,
    @Query() query: unknown
  ): Promise<NewGuidsResponse> {
    const validated = validateAgentNewGuidsRequest(feedId, body, query);
    if (!validated.ok) {
      throw validationError();
    }

    requirePrincipal(request);

    try {
      return await this.filterNewGuids.execute(validated.value);
    } catch (error) {
      if (error instanceof AgentNewGuidsFeedNotFoundError) {
        throw validationError();
      }

      throw error;
    }
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
