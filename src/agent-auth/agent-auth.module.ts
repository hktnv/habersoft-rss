import { Module } from "@nestjs/common";
import { AgentKeyAuthGuard } from "./agent-key-auth.guard";
import { AgentKeyHeaderParser } from "./agent-key-header.parser";
import { AgentKeyVerifier } from "./agent-key.verifier";

@Module({
  providers: [AgentKeyHeaderParser, AgentKeyVerifier, AgentKeyAuthGuard],
  exports: [AgentKeyHeaderParser, AgentKeyVerifier, AgentKeyAuthGuard]
})
export class AgentAuthModule {}
