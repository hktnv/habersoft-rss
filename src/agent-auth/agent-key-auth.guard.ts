import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AGENT_PRINCIPAL_REQUEST_KEY } from "./agent-auth.constants";
import { AgentAuthenticatedRequest } from "./agent-auth.types";
import { AgentKeyHeaderParser } from "./agent-key-header.parser";
import { AgentKeyVerifier } from "./agent-key.verifier";
import { createAgentPrincipal } from "./agent-principal";

@Injectable()
export class AgentKeyAuthGuard implements CanActivate {
  public constructor(
    private readonly parser: AgentKeyHeaderParser,
    private readonly verifier: AgentKeyVerifier
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AgentAuthenticatedRequest>();
    const parsed = this.parser.parse({
      headers: request.headers,
      rawHeaders: request.raw.rawHeaders
    });

    if (!parsed.ok || !this.verifier.verify(parsed.candidate)) {
      throw new UnauthorizedException();
    }

    request[AGENT_PRINCIPAL_REQUEST_KEY] = createAgentPrincipal();
    return true;
  }
}
