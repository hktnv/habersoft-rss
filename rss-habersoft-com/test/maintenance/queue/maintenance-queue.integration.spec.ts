import { Queue } from "bullmq";
import type { QueueOptions } from "bullmq";
import type { CleanupOrchestrator } from "../../../src/maintenance/cleanup.orchestrator";
import { MaintenanceQueueRunner } from "../../../src/maintenance/maintenance.queue-runner";
import {
  CLEANUP_DAILY_CRON_PATTERN,
  CLEANUP_DAILY_SCHEDULER_ID,
  CLEANUP_DAILY_TIMEZONE,
  CLEANUP_RUN_JOB_NAME,
  MAINTENANCE_GLOBAL_CONCURRENCY,
  MAINTENANCE_QUEUE_NAME,
  cleanupRunJobPayload
} from "../../../src/maintenance/maintenance.registry";
import type { RuntimeConfig } from "../../../src/configuration/runtime-config";

function requireRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for maintenance queue integration tests.");
  }

  return redisUrl;
}

describe("maintenance queue with Redis/BullMQ", () => {
  const prefix = `ms014:${Date.now()}`;
  let queue: Queue;
  let runner: MaintenanceQueueRunner | undefined;
  let runs = 0;

  beforeEach(async () => {
    runs = 0;
    queue = new Queue(MAINTENANCE_QUEUE_NAME, { connection: connection(requireRedisUrl()), prefix });
    await queue.obliterate({ force: true });
  });

  afterEach(async () => {
    await runner?.onModuleDestroy();
    runner = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  });

  it("reconciles one scheduler, global concurrency, and processes a typed cleanup job", async () => {
    runner = new MaintenanceQueueRunner(
      runtimeConfig(prefix),
      orchestrator(() => {
        runs += 1;
      }),
      bootstrap()
    );
    await runner.onModuleInit();
    await runner.reconcileScheduler();

    const health = await runner.health();
    expect(health.ready).toBe(true);
    expect(health.globalConcurrency).toBe(MAINTENANCE_GLOBAL_CONCURRENCY);
    expect(health.schedulerPattern).toBe(CLEANUP_DAILY_CRON_PATTERN);
    expect(health.schedulerTimezone).toBe(CLEANUP_DAILY_TIMEZONE);
    expect((await queue.getJobSchedulers()).filter((scheduler) => scheduler.key === CLEANUP_DAILY_SCHEDULER_ID)).toHaveLength(1);

    const job = await queue.add(CLEANUP_RUN_JOB_NAME, cleanupRunJobPayload());
    await waitFor(() => runs === 1);
    expect(await job.getState()).toBe("completed");
  });
});

function runtimeConfig(prefix: string): RuntimeConfig {
  return {
    role: "worker",
    environment: "test",
    logLevel: "info",
    api: { host: "0.0.0.0", port: 3000 },
    postgres: { url: "postgresql://unused:unused@postgres:5432/unused" },
    redis: { url: requireRedisUrl() },
    maintenance: {
      entryRetentionDays: 30,
      entryMaxPerFeed: 10000,
      entryDetailRetentionDays: 7,
      entryDetailMaxPerFeed: 2000,
      bullmqPrefix: prefix,
      completedJobRetentionSeconds: 60,
      completedJobMaxCount: 100,
      failedJobRetentionSeconds: 60,
      failedJobMaxCount: 100
    }
  };
}

function orchestrator(onRun: () => void): CleanupOrchestrator {
  return {
    run: jest.fn().mockImplementation(() => {
      onRun();
      return Promise.resolve({
        terminalStatus: "succeeded",
        steps: []
      });
    })
  } as unknown as CleanupOrchestrator;
}

function bootstrap(): never {
  return {
    assertInfrastructureReady: jest.fn().mockResolvedValue(undefined)
  } as never;
}

function connection(redisUrl: string): QueueOptions["connection"] {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    db: Number(parsed.pathname.replace("/", "") || "0"),
    maxRetriesPerRequest: null
  };
}

async function waitFor(predicate: () => Promise<boolean> | boolean): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    if (await predicate()) {
      return;
    }

    if (Date.now() - startedAt > 10_000) {
      throw new Error("timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
