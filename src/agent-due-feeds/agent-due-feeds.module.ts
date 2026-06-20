import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { AgentDueFeedsController } from "./agent-due-feeds.controller";
import { AGENT_DUE_FEEDS_CLOCK, SystemAgentDueFeedsClock } from "./agent-due-feeds.clock";
import { AgentDueFeedsReader } from "./agent-due-feeds.reader";
import { ListAgentDueFeedsUseCase } from "./list-agent-due-feeds.use-case";

@Module({
  imports: [AgentAuthModule, PersistenceModule],
  controllers: [AgentDueFeedsController],
  providers: [
    AgentDueFeedsReader,
    {
      provide: SystemAgentDueFeedsClock,
      useClass: SystemAgentDueFeedsClock
    },
    {
      provide: AGENT_DUE_FEEDS_CLOCK,
      useExisting: SystemAgentDueFeedsClock
    },
    ListAgentDueFeedsUseCase
  ]
})
export class AgentDueFeedsModule {}
