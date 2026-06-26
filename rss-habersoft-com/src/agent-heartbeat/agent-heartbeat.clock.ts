import { Injectable } from "@nestjs/common";

export type AgentHeartbeatClock = {
  readonly now: () => Date;
};

export const AGENT_HEARTBEAT_CLOCK = Symbol("AGENT_HEARTBEAT_CLOCK");

@Injectable()
export class SystemAgentHeartbeatClock implements AgentHeartbeatClock {
  public now(): Date {
    return new Date();
  }
}
