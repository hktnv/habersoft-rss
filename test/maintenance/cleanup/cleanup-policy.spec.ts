import {
  AGENT_FEED_CHECK_EVENTS_RETENTION_HOURS,
  CLEANUP_AGE_DELETE_BATCH_SIZE,
  CLEANUP_DAILY_CRON_PATTERN,
  CLEANUP_DAILY_SCHEDULER_ID,
  CLEANUP_DAILY_TIMEZONE,
  CLEANUP_EVENT_DELETE_BATCH_SIZE,
  CLEANUP_OVER_CAP_FEEDS_PER_RUN,
  CLEANUP_PER_FEED_DELETE_BATCH_SIZE,
  CLEANUP_RUN_JOB_NAME,
  MAINTENANCE_GLOBAL_CONCURRENCY,
  MAINTENANCE_QUEUE_NAME,
  MAINTENANCE_WORKER_CONCURRENCY,
  cleanupRunJobPayload,
  isCleanupRunJobPayload
} from "../../../src/maintenance/maintenance.registry";

describe("maintenance cleanup policy registry", () => {
  it("keeps canonical queue, scheduler, schedule, concurrency, and batch constants", () => {
    expect(MAINTENANCE_QUEUE_NAME).toBe("main-service.maintenance");
    expect(CLEANUP_RUN_JOB_NAME).toBe("cleanup.run.v1");
    expect(CLEANUP_DAILY_SCHEDULER_ID).toBe("cleanup.daily");
    expect(CLEANUP_DAILY_CRON_PATTERN).toBe("0 3 * * *");
    expect(CLEANUP_DAILY_TIMEZONE).toBe("UTC");
    expect(MAINTENANCE_GLOBAL_CONCURRENCY).toBe(1);
    expect(MAINTENANCE_WORKER_CONCURRENCY).toBe(1);
    expect(CLEANUP_AGE_DELETE_BATCH_SIZE).toBe(10_000);
    expect(CLEANUP_EVENT_DELETE_BATCH_SIZE).toBe(10_000);
    expect(CLEANUP_OVER_CAP_FEEDS_PER_RUN).toBe(50);
    expect(CLEANUP_PER_FEED_DELETE_BATCH_SIZE).toBe(1_000);
    expect(AGENT_FEED_CHECK_EVENTS_RETENTION_HOURS).toBe(48);
  });

  it("validates typed cleanup payloads", () => {
    expect(isCleanupRunJobPayload(cleanupRunJobPayload())).toBe(true);
    expect(isCleanupRunJobPayload({ schema_version: 2, scheduler_id: "cleanup.daily" })).toBe(false);
    expect(isCleanupRunJobPayload({ schema_version: 1, scheduler_id: "other" })).toBe(false);
  });
});
