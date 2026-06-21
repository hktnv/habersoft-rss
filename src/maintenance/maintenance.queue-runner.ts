import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";
import type { Job, JobsOptions, QueueOptions, WorkerOptions } from "bullmq";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import type { MaintenanceConfig, RuntimeConfig } from "../configuration/runtime-config";
import { WorkerBootstrapService } from "../worker/worker-bootstrap.service";
import { CleanupRunFailedError, CleanupOrchestrator } from "./cleanup.orchestrator";
import {
  CLEANUP_DAILY_CRON_PATTERN,
  CLEANUP_DAILY_SCHEDULER_ID,
  CLEANUP_DAILY_TIMEZONE,
  CLEANUP_PREFLIGHT_ATTEMPTS,
  CLEANUP_PREFLIGHT_BACKOFF_MS,
  CLEANUP_RUN_JOB_NAME,
  MAINTENANCE_GLOBAL_CONCURRENCY,
  MAINTENANCE_QUEUE_NAME,
  MAINTENANCE_WORKER_CONCURRENCY,
  cleanupRunJobPayload,
  isCleanupRunJobPayload
} from "./maintenance.registry";
import type { CleanupRunJobPayload } from "./maintenance.registry";

export type MaintenanceQueueHealth = {
  readonly queue: typeof MAINTENANCE_QUEUE_NAME;
  readonly schedulerId: typeof CLEANUP_DAILY_SCHEDULER_ID;
  readonly globalConcurrency: number | null;
  readonly schedulerNext: number | null;
  readonly schedulerPattern: string | null;
  readonly schedulerTimezone: string | null;
  readonly ready: boolean;
};

type MaintenanceJobName = string;

@Injectable()
export class MaintenanceQueueRunner implements OnModuleInit, OnModuleDestroy {
  private readonly queueOptions: QueueOptions;
  private readonly workerOptions: WorkerOptions;
  private readonly maintenanceConfig: MaintenanceConfig;
  private queue: Queue<CleanupRunJobPayload, unknown, MaintenanceJobName> | undefined;
  private queueEvents: QueueEvents | undefined;
  private worker: Worker<CleanupRunJobPayload, unknown, MaintenanceJobName> | undefined;

  public constructor(
    @Inject(RUNTIME_CONFIG) config: RuntimeConfig,
    private readonly orchestrator: CleanupOrchestrator,
    private readonly bootstrap: WorkerBootstrapService
  ) {
    if (config.maintenance === undefined) {
      throw new Error("maintenance configuration is required for queue runner");
    }

    const connection = redisConnectionOptions(config.redis.url);
    this.maintenanceConfig = config.maintenance;
    this.queueOptions = { connection, prefix: config.maintenance.bullmqPrefix };
    this.workerOptions = {
      connection,
      prefix: config.maintenance.bullmqPrefix,
      concurrency: MAINTENANCE_WORKER_CONCURRENCY,
      removeOnComplete: {
        age: config.maintenance.completedJobRetentionSeconds,
        count: config.maintenance.completedJobMaxCount
      },
      removeOnFail: {
        age: config.maintenance.failedJobRetentionSeconds,
        count: config.maintenance.failedJobMaxCount
      }
    };
  }

  public async onModuleInit(): Promise<void> {
    this.queue = new Queue<CleanupRunJobPayload, unknown, MaintenanceJobName>(MAINTENANCE_QUEUE_NAME, this.queueOptions);
    await this.queue.waitUntilReady();
    await this.reconcileScheduler();

    this.queueEvents = new QueueEvents(MAINTENANCE_QUEUE_NAME, this.queueOptions);
    await this.queueEvents.waitUntilReady();

    this.worker = new Worker<CleanupRunJobPayload, unknown, MaintenanceJobName>(
      MAINTENANCE_QUEUE_NAME,
      (job) => this.process(job),
      this.workerOptions
    );
    await this.worker.waitUntilReady();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queueEvents?.close();
    await this.queue?.close();
  }

  public async health(): Promise<MaintenanceQueueHealth> {
    const queue = this.requireQueue();
    const [globalConcurrency, scheduler] = await Promise.all([
      queue.getGlobalConcurrency(),
      queue.getJobScheduler(CLEANUP_DAILY_SCHEDULER_ID)
    ]);

    return {
      queue: MAINTENANCE_QUEUE_NAME,
      schedulerId: CLEANUP_DAILY_SCHEDULER_ID,
      globalConcurrency,
      schedulerNext: scheduler?.next ?? null,
      schedulerPattern: scheduler?.pattern ?? null,
      schedulerTimezone: scheduler?.tz ?? null,
      ready:
        globalConcurrency === MAINTENANCE_GLOBAL_CONCURRENCY &&
        scheduler?.name === CLEANUP_RUN_JOB_NAME &&
        scheduler.pattern === CLEANUP_DAILY_CRON_PATTERN &&
        scheduler.tz === CLEANUP_DAILY_TIMEZONE
    };
  }

  public async reconcileScheduler(): Promise<void> {
    const queue = this.requireQueue();
    await queue.setGlobalConcurrency(MAINTENANCE_GLOBAL_CONCURRENCY);
    await queue.upsertJobScheduler(
      CLEANUP_DAILY_SCHEDULER_ID,
      {
        pattern: CLEANUP_DAILY_CRON_PATTERN,
        tz: CLEANUP_DAILY_TIMEZONE
      },
      {
        name: CLEANUP_RUN_JOB_NAME,
        data: cleanupRunJobPayload(),
        opts: this.schedulerJobOptions()
      }
    );

    const health = await this.health();
    if (!health.ready) {
      throw new Error("maintenance scheduler inventory reconciliation failed");
    }
  }

  private async process(job: Job<CleanupRunJobPayload, unknown, MaintenanceJobName>): Promise<unknown> {
    if (job.name !== CLEANUP_RUN_JOB_NAME || !isCleanupRunJobPayload(job.data)) {
      throw new UnrecoverableError("unknown maintenance job payload");
    }

    await this.bootstrap.assertInfrastructureReady();

    try {
      return await this.orchestrator.run({
        jobId: job.id ?? "unknown",
        attempt: job.attemptsMade + 1,
        runCorrelationId: `${job.id ?? "unknown"}:${job.attemptsMade + 1}`
      });
    } catch (error: unknown) {
      if (error instanceof CleanupRunFailedError) {
        throw new UnrecoverableError(error.message);
      }

      throw error;
    }
  }

  private schedulerJobOptions(): JobsOptions {
    return {
      attempts: CLEANUP_PREFLIGHT_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: CLEANUP_PREFLIGHT_BACKOFF_MS
      },
      removeOnComplete: {
        age: this.maintenanceConfig.completedJobRetentionSeconds,
        count: this.maintenanceConfig.completedJobMaxCount
      },
      removeOnFail: {
        age: this.maintenanceConfig.failedJobRetentionSeconds,
        count: this.maintenanceConfig.failedJobMaxCount
      }
    };
  }

  private requireQueue(): Queue<CleanupRunJobPayload, unknown, MaintenanceJobName> {
    if (this.queue === undefined) {
      throw new Error("maintenance queue is not initialized");
    }

    return this.queue;
  }
}

function redisConnectionOptions(redisUrl: string): QueueOptions["connection"] {
  const parsed = new URL(redisUrl);

  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 6379 : Number(parsed.port),
    username: parsed.username === "" ? undefined : decodeURIComponent(parsed.username),
    password: parsed.password === "" ? undefined : decodeURIComponent(parsed.password),
    db: parseRedisDatabase(parsed),
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

function parseRedisDatabase(parsed: URL): number {
  const text = parsed.pathname.replace("/", "");
  if (text === "") {
    return 0;
  }

  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
