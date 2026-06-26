import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { AgentNewGuidsController } from "./agent-new-guids.controller";
import { AgentNewGuidsReader } from "./agent-new-guids.reader";
import { FilterAgentNewGuidsUseCase } from "./filter-agent-new-guids.use-case";

@Module({
  imports: [AgentAuthModule, PersistenceModule],
  controllers: [AgentNewGuidsController],
  providers: [AgentNewGuidsReader, FilterAgentNewGuidsUseCase]
})
export class AgentNewGuidsModule {}
