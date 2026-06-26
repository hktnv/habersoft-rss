export const MAINTENANCE_QUEUE_NAME = "main-service.maintenance";
export const CLEANUP_RUN_JOB_NAME = "cleanup.run.v1";
export const CLEANUP_DAILY_SCHEDULER_ID = "cleanup.daily";
export const CLEANUP_DAILY_CRON_PATTERN = "0 3 * * *";
export const CLEANUP_DAILY_TIMEZONE = "UTC";

export const MAINTENANCE_GLOBAL_CONCURRENCY = 1;
export const MAINTENANCE_WORKER_CONCURRENCY = 1;
export const CLEANUP_PREFLIGHT_ATTEMPTS = 3;
export const CLEANUP_PREFLIGHT_BACKOFF_MS = 30_000;

export const CLEANUP_AGE_DELETE_BATCH_SIZE = 10_000;
export const CLEANUP_EVENT_DELETE_BATCH_SIZE = 10_000;
export const CLEANUP_OVER_CAP_FEEDS_PER_RUN = 50;
export const CLEANUP_PER_FEED_DELETE_BATCH_SIZE = 1_000;
export const AGENT_FEED_CHECK_EVENTS_RETENTION_HOURS = 48;

export const cleanupStepIds = [
  "entries_age",
  "entries_cap",
  "entry_details_age",
  "entry_details_cap",
  "agent_feed_check_events_age",
  "vacuum_analyze",
  "run_summary"
] as const;

export type CleanupStepId = (typeof cleanupStepIds)[number];

export type CleanupRunJobPayload = {
  readonly schema_version: 1;
  readonly scheduler_id: typeof CLEANUP_DAILY_SCHEDULER_ID;
};

export function cleanupRunJobPayload(): CleanupRunJobPayload {
  return {
    schema_version: 1,
    scheduler_id: CLEANUP_DAILY_SCHEDULER_ID
  };
}

export function isCleanupRunJobPayload(value: unknown): value is CleanupRunJobPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.schema_version === 1 && record.scheduler_id === CLEANUP_DAILY_SCHEDULER_ID;
}
