export type AgentNewGuidsRequest = {
  readonly feedId: bigint;
  readonly guids: readonly string[];
};

export type ExistingGuidReadInput = {
  readonly feedId: bigint;
  readonly guids: readonly string[];
};

export type ExistingGuidReadResult = {
  readonly existingGuids: readonly string[];
};

export type NewGuidsResponse = {
  readonly new: readonly string[];
};

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
    };
