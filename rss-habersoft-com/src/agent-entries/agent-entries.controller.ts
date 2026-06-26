import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards
} from "@nestjs/common";
import { AGENT_PRINCIPAL_REQUEST_KEY } from "../agent-auth/agent-auth.constants";
import type { AgentAuthenticatedRequest, AgentPrincipal } from "../agent-auth/agent-auth.types";
import { AgentKeyAuthGuard } from "../agent-auth/agent-key-auth.guard";
import {
  AgentEntriesCheckedAtInFutureError,
  AgentEntriesCheckedAtTooOldError,
  AgentEntriesCheckIdPayloadMismatchError,
  AgentEntriesFeedNotFoundError
} from "./agent-entries.error";
import type { AgentEntriesResponse, AgentEntriesValidationErrorCode } from "./agent-entries.types";
import { validateAgentEntriesRequest } from "./agent-entries.validation";
import { RecordAgentEntriesUseCase } from "./record-agent-entries.use-case";

@Controller("agent/entries")
@UseGuards(AgentKeyAuthGuard)
export class AgentEntriesController {
  public constructor(private readonly recordEntries: RecordAgentEntriesUseCase) {}

  @Post()
  @HttpCode(200)
  public async record(
    @Req() request: AgentAuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: unknown
  ): Promise<AgentEntriesResponse> {
    const validated = validateAgentEntriesRequest(body, query);
    if (!validated.ok) {
      throw validationError(validated.errorCode);
    }

    requirePrincipal(request);

    try {
      return await this.recordEntries.execute(validated.value);
    } catch (error) {
      if (error instanceof AgentEntriesCheckedAtTooOldError) {
        throw validationError("CHECKED_AT_TOO_OLD");
      }

      if (error instanceof AgentEntriesCheckedAtInFutureError) {
        throw validationError("CHECKED_AT_IN_FUTURE");
      }

      if (error instanceof AgentEntriesCheckIdPayloadMismatchError) {
        throw validationError("CHECK_ID_PAYLOAD_MISMATCH");
      }

      if (error instanceof AgentEntriesFeedNotFoundError) {
        throw validationError("VALIDATION_FAILED");
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

function validationError(errorCode: AgentEntriesValidationErrorCode): UnprocessableEntityException {
  return new UnprocessableEntityException({ error_code: errorCode });
}
