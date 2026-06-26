import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module";
import { PersistenceModule } from "../persistence/persistence.module";
import { AgentHeartbeatController } from "./agent-heartbeat.controller";
import { AGENT_HEARTBEAT_CLOCK, SystemAgentHeartbeatClock } from "./agent-heartbeat.clock";
import { AgentHeartbeatRepository } from "./agent-heartbeat.repository";
import { RecordAgentHeartbeatUseCase } from "./record-agent-heartbeat.use-case";

@Module({
  imports: [AgentAuthModule, PersistenceModule],
  controllers: [AgentHeartbeatController],
  providers: [
    AgentHeartbeatRepository,
    {
      provide: SystemAgentHeartbeatClock,
      useClass: SystemAgentHeartbeatClock
    },
    {
      provide: AGENT_HEARTBEAT_CLOCK,
      useExisting: SystemAgentHeartbeatClock
    },
    RecordAgentHeartbeatUseCase
  ]
})
export class AgentHeartbeatModule {}
