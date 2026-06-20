export type AgentHeartbeatInput = {
  readonly agentId: "default";
  readonly status: string;
  readonly sentAt: Date;
  readonly feedsProcessed: number;
  readonly errorsCount: number;
  readonly staleCheckResultsDropped: number;
  readonly staleEntriesDropped: number;
};

export type AgentHeartbeatWriteInput = AgentHeartbeatInput & {
  readonly receivedAt: Date;
};

export type AgentHeartbeatRequest = {
  readonly status: string;
  readonly sentAt: Date;
  readonly feedsProcessed: number;
  readonly errorsCount: number;
  readonly staleCheckResultsDropped: number;
  readonly staleEntriesDropped: number;
};

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
    };
