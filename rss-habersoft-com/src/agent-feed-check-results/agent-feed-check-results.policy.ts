import { FEED_POLL_INTERVAL_SECONDS } from "../agent-entries/agent-entries.policy";

export const AGENT_FEED_CHECK_RESULTS_BODY_LIMIT_BYTES = 256 * 1024;
export const MAX_AGENT_FEED_CHECK_RESULTS_PER_REQUEST = 250;
export { FEED_POLL_INTERVAL_SECONDS };

export function nextPhaseSlotAfter(checkedAt: Date, feedId: bigint, feedCreatedAt: Date): Date {
  const intervalMs = FEED_POLL_INTERVAL_SECONDS * 1000;
  const phaseSeconds = Number(feedId % BigInt(FEED_POLL_INTERVAL_SECONDS));
  const anchorMs = feedCreatedAt.getTime() + phaseSeconds * 1000;
  const checkedMs = checkedAt.getTime();

  if (anchorMs > checkedMs) {
    return new Date(anchorMs);
  }

  const elapsedSlots = Math.floor((checkedMs - anchorMs) / intervalMs) + 1;
  return new Date(anchorMs + elapsedSlots * intervalMs);
}

export function failureBackoffAfter(checkedAt: Date, newErrorCount: number): Date {
  const exponent = Math.min(newErrorCount, 6);
  return new Date(checkedAt.getTime() + FEED_POLL_INTERVAL_SECONDS * 1000 * 2 ** exponent);
}
