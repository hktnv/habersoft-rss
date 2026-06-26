import { Injectable } from "@nestjs/common";

export type AgentFeedCheckResultsClock = {
  readonly now: () => Date;
};

export const AGENT_FEED_CHECK_RESULTS_CLOCK = Symbol("AGENT_FEED_CHECK_RESULTS_CLOCK");

@Injectable()
export class SystemAgentFeedCheckResultsClock implements AgentFeedCheckResultsClock {
  public now(): Date {
    return new Date();
  }
}
