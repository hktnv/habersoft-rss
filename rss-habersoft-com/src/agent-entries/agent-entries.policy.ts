export const AGENT_ENTRIES_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_FASTIFY_BODY_LIMIT_BYTES = 1024 * 1024;
export const MAX_AGENT_ENTRIES_PER_REQUEST = 100;
export const FEED_POLL_INTERVAL_SECONDS = 900;

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
