import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { AgentEntriesController } from "./agent-entries.controller";
import { AGENT_ENTRIES_CLOCK, SystemAgentEntriesClock } from "./agent-entries.clock";
import { AgentEntriesWriter } from "./agent-entries.writer";
import { RecordAgentEntriesUseCase } from "./record-agent-entries.use-case";

@Module({
  imports: [AgentAuthModule, PersistenceModule],
  controllers: [AgentEntriesController],
  providers: [
    AgentEntriesWriter,
    {
      provide: SystemAgentEntriesClock,
      useClass: SystemAgentEntriesClock
    },
    {
      provide: AGENT_ENTRIES_CLOCK,
      useExisting: SystemAgentEntriesClock
    },
    RecordAgentEntriesUseCase
  ]
})
export class AgentEntriesModule {}
