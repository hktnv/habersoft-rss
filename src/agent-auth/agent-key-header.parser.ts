import { Injectable } from "@nestjs/common";
import { AgentKeyParseResult } from "./agent-auth.types";

const publicAgentKeyHeader = "x-agent-key";

export type AgentKeyHeaderInput = {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawHeaders?: readonly string[];
};

@Injectable()
export class AgentKeyHeaderParser {
  public parse(input: AgentKeyHeaderInput): AgentKeyParseResult {
    const candidateCount = this.countRawHeader(input.rawHeaders);

    if (candidateCount !== undefined) {
      if (candidateCount === 0) {
        return { ok: false, reason: "agent_key_header_missing" };
      }

      if (candidateCount > 1) {
        return { ok: false, reason: "agent_key_header_multiple" };
      }
    }

    const found = this.findHeaderValue(input.headers);
    if (candidateCount === undefined && found.count > 1) {
      return { ok: false, reason: "agent_key_header_multiple" };
    }

    const value = found.value;
    if (value === undefined) {
      return { ok: false, reason: "agent_key_header_missing" };
    }

    if (Array.isArray(value)) {
      return { ok: false, reason: "agent_key_header_multiple" };
    }

    if (value.trim() === "") {
      return { ok: false, reason: "agent_key_header_malformed" };
    }

    return { ok: true, candidate: value };
  }

  private countRawHeader(rawHeaders: readonly string[] | undefined): number | undefined {
    if (rawHeaders === undefined) {
      return undefined;
    }

    let count = 0;
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (rawHeaders[index]?.toLowerCase() === publicAgentKeyHeader) {
        count += 1;
      }
    }

    return count;
  }

  private findHeaderValue(headers: Record<string, string | string[] | undefined>): {
    readonly count: number;
    readonly value: string | string[] | undefined;
  } {
    let count = 0;
    let foundValue: string | string[] | undefined;

    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === publicAgentKeyHeader) {
        count += 1;
        foundValue = value;
      }
    }

    return { count, value: foundValue };
  }
}
