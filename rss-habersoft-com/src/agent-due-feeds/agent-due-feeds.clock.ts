import { Injectable } from "@nestjs/common";

export type AgentDueFeedsClock = {
  readonly now: () => Date;
};

export const AGENT_DUE_FEEDS_CLOCK = Symbol("AGENT_DUE_FEEDS_CLOCK");

@Injectable()
export class SystemAgentDueFeedsClock implements AgentDueFeedsClock {
  public now(): Date {
    return new Date();
  }
}
