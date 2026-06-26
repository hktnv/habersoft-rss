import { Injectable } from "@nestjs/common";

export type AgentEntriesClock = {
  readonly now: () => Date;
};

export const AGENT_ENTRIES_CLOCK = Symbol("AGENT_ENTRIES_CLOCK");

@Injectable()
export class SystemAgentEntriesClock implements AgentEntriesClock {
  public now(): Date {
    return new Date();
  }
}
