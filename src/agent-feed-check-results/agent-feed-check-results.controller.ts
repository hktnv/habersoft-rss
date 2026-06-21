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
  AgentFeedCheckResultsCheckedAtInFutureError,
  AgentFeedCheckResultsCheckedAtTooOldError,
  AgentFeedCheckResultsCheckIdPayloadMismatchError,
  AgentFeedCheckResultsFeedNotFoundError
} from "./agent-feed-check-results.error";
import type {
  AgentFeedCheckResultsResponse,
  AgentFeedCheckResultsValidationErrorCode
} from "./agent-feed-check-results.types";
import { validateAgentFeedCheckResultsRequest } from "./agent-feed-check-results.validation";
import { RecordAgentFeedCheckResultsUseCase } from "./record-agent-feed-check-results.use-case";

@Controller("agent/feed-check-results")
@UseGuards(AgentKeyAuthGuard)
export class AgentFeedCheckResultsController {
  public constructor(private readonly recordResults: RecordAgentFeedCheckResultsUseCase) {}

  @Post()
  @HttpCode(200)
  public async record(
    @Req() request: AgentAuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: unknown
  ): Promise<AgentFeedCheckResultsResponse> {
    const validated = validateAgentFeedCheckResultsRequest(body, query);
    if (!validated.ok) {
      throw validationError(validated.errorCode);
    }

    requirePrincipal(request);

    try {
      return await this.recordResults.execute(validated.value);
    } catch (error) {
      if (error instanceof AgentFeedCheckResultsCheckedAtTooOldError) {
        throw validationError("CHECKED_AT_TOO_OLD");
      }

      if (error instanceof AgentFeedCheckResultsCheckedAtInFutureError) {
        throw validationError("CHECKED_AT_IN_FUTURE");
      }

      if (error instanceof AgentFeedCheckResultsCheckIdPayloadMismatchError) {
        throw validationError("CHECK_ID_PAYLOAD_MISMATCH");
      }

      if (error instanceof AgentFeedCheckResultsFeedNotFoundError) {
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

function validationError(errorCode: AgentFeedCheckResultsValidationErrorCode): UnprocessableEntityException {
  return new UnprocessableEntityException({ error_code: errorCode });
}
