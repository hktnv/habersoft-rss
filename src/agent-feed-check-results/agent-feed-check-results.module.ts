import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { AGENT_FEED_CHECK_RESULTS_CLOCK, SystemAgentFeedCheckResultsClock } from "./agent-feed-check-results.clock";
import { AgentFeedCheckResultsController } from "./agent-feed-check-results.controller";
import { AgentFeedCheckResultsWriter } from "./agent-feed-check-results.writer";
import { RecordAgentFeedCheckResultsUseCase } from "./record-agent-feed-check-results.use-case";

@Module({
  imports: [AgentAuthModule, PersistenceModule],
  controllers: [AgentFeedCheckResultsController],
  providers: [
    AgentFeedCheckResultsWriter,
    {
      provide: SystemAgentFeedCheckResultsClock,
      useClass: SystemAgentFeedCheckResultsClock
    },
    {
      provide: AGENT_FEED_CHECK_RESULTS_CLOCK,
      useExisting: SystemAgentFeedCheckResultsClock
    },
    RecordAgentFeedCheckResultsUseCase
  ]
})
export class AgentFeedCheckResultsModule {}
