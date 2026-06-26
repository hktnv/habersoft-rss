import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import type { QueueOptions } from "bullmq";
import Redis from "ioredis";
import { loadRuntimeConfig } from "../configuration/runtime-config";
import {
  CLEANUP_DAILY_CRON_PATTERN,
  CLEANUP_DAILY_SCHEDULER_ID,
  CLEANUP_DAILY_TIMEZONE,
  CLEANUP_RUN_JOB_NAME,
  MAINTENANCE_GLOBAL_CONCURRENCY,
  MAINTENANCE_QUEUE_NAME
} from "../maintenance/maintenance.registry";

export type WorkerHealthResult = {
  readonly postgres: "up";
  readonly redis: "up";
  readonly queue: typeof MAINTENANCE_QUEUE_NAME;
  readonly scheduler_id: typeof CLEANUP_DAILY_SCHEDULER_ID;
  readonly scheduler_next: string;
  readonly global_concurrency: typeof MAINTENANCE_GLOBAL_CONCURRENCY;
};

export async function checkWorkerHealth(env: NodeJS.ProcessEnv = process.env): Promise<WorkerHealthResult> {
  const config = loadRuntimeConfig(env, "worker");
  const postgres = new PrismaClient({
    datasources: {
      db: {
        url: config.postgres.url
      }
    }
  });
  const redis = new Redis(config.redis.url, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
  const queue = new Queue(MAINTENANCE_QUEUE_NAME, {
    connection: redisConnectionOptions(config.redis.url),
    prefix: config.maintenance?.bullmqPrefix
  });

  try {
    await postgres.$connect();
    await postgres.$queryRaw`SELECT 1`;
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error("Redis health check failed");
    }

    const [scheduler, globalConcurrency] = await Promise.all([
      queue.getJobScheduler(CLEANUP_DAILY_SCHEDULER_ID),
      queue.getGlobalConcurrency()
    ]);

    if (
      scheduler?.name !== CLEANUP_RUN_JOB_NAME ||
      scheduler.pattern !== CLEANUP_DAILY_CRON_PATTERN ||
      scheduler.tz !== CLEANUP_DAILY_TIMEZONE ||
      scheduler.next === undefined ||
      globalConcurrency !== MAINTENANCE_GLOBAL_CONCURRENCY
    ) {
      throw new Error("Maintenance scheduler inventory is not ready");
    }

    return {
      postgres: "up",
      redis: "up",
      queue: MAINTENANCE_QUEUE_NAME,
      scheduler_id: CLEANUP_DAILY_SCHEDULER_ID,
      scheduler_next: new Date(scheduler.next).toISOString(),
      global_concurrency: MAINTENANCE_GLOBAL_CONCURRENCY
    };
  } finally {
    await queue.close();
    await redis.quit().catch(() => undefined);
    await postgres.$disconnect();
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
