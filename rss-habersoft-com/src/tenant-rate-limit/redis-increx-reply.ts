export type ParsedIncrexReply =
  | {
      readonly ok: true;
      readonly count: number;
    }
  | {
      readonly ok: false;
    };

export function parseIncrexReply(reply: unknown): ParsedIncrexReply {
  if (!Array.isArray(reply) || reply.length < 1) {
    return { ok: false };
  }

  const count = toInteger(reply[0]);
  if (count === undefined || count < 1) {
    return { ok: false };
  }

  return {
    ok: true,
    count
  };
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) {
    return Number(value);
  }

  return undefined;
}
