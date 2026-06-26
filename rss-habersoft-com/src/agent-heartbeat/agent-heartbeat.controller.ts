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
import { RecordAgentHeartbeatUseCase } from "./record-agent-heartbeat.use-case";
import { validateAgentHeartbeatRequest, validateNoQueryParameters } from "./agent-heartbeat.validation";

type HeartbeatResponse = {
  readonly ok: true;
};

@Controller("agent/heartbeat")
@UseGuards(AgentKeyAuthGuard)
export class AgentHeartbeatController {
  public constructor(private readonly recordHeartbeat: RecordAgentHeartbeatUseCase) {}

  @Post()
  @HttpCode(200)
  public async record(
    @Req() request: AgentAuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: unknown
  ): Promise<HeartbeatResponse> {
    const validatedQuery = validateNoQueryParameters(query);
    const validatedBody = validateAgentHeartbeatRequest(body);

    if (!validatedQuery.ok || !validatedBody.ok) {
      throw validationError();
    }

    await this.recordHeartbeat.execute(requirePrincipal(request), validatedBody.value);
    return { ok: true };
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
