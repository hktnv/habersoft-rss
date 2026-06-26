import { RedisService } from "../../src/redis/redis.service";
import { deriveTenantRateLimitKey } from "../../src/tenant-rate-limit/tenant-rate-limit.key-derivation";
import { RedisTenantRateLimitStore } from "../../src/tenant-rate-limit/redis-tenant-rate-limit.store";
import { TenantRateLimitService } from "../../src/tenant-rate-limit/tenant-rate-limit.service";
import type { RuntimeConfig } from "../../src/configuration/runtime-config";
import { runtimeConfig, tenantRateLimitConfig } from "../tenant-auth/tenant-auth-test-helpers";

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl === undefined ? describe.skip : describe;

type RedisHarness = {
  readonly config: RuntimeConfig;
  readonly redis: RedisService;
  readonly subject: TenantRateLimitService;
};

describeRedis("TenantRateLimitService Redis integration", () => {
  const harnesses: RedisHarness[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => closeHarness(harness)));
  });

  it("isolates tenant A and tenant B", async () => {
    const harness = await createHarness({ maxRequests: 2, windowSeconds: 30 });

    await expect(harness.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    await expect(harness.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    await expect(harness.subject.consume("site-client-a")).resolves.toMatchObject({ outcome: "limited" });
    await expect(harness.subject.consume("site-client-b")).resolves.toEqual({ outcome: "allowed" });
  });

  it("enforces the exact accepted count under concurrency", async () => {
    const harness = await createHarness({ maxRequests: 5, windowSeconds: 30 });

    const results = await Promise.all(Array.from({ length: 10 }, () => harness.subject.consume("site-client-a")));

    expect(results.filter((result) => result.outcome === "allowed")).toHaveLength(5);
    expect(results.filter((result) => result.outcome === "limited")).toHaveLength(5);
  });

  it("shares quota across service instances", async () => {
    const prefix = uniquePrefix();
    const first = await createHarness({ maxRequests: 2, windowSeconds: 30, prefix });
    const second = await createHarness({ maxRequests: 2, windowSeconds: 30, prefix });

    await expect(first.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    await expect(second.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    await expect(first.subject.consume("site-client-a")).resolves.toMatchObject({ outcome: "limited" });
  });

  it("opens a new window after expiry", async () => {
    const harness = await createHarness({ maxRequests: 1, windowSeconds: 1 });

    await expect(harness.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    await expect(harness.subject.consume("site-client-a")).resolves.toMatchObject({ outcome: "limited" });
    await sleep(1200);
    await expect(harness.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
  });

  it("does not extend the window TTL on rejected requests", async () => {
    const harness = await createHarness({ maxRequests: 1, windowSeconds: 2 });
    const key = deriveTenantRateLimitKey({
      tenantIdentifier: "site-client-a",
      redisPrefix: harness.config.tenantRateLimit?.redisPrefix ?? "",
      keySecret: tenantRateLimitConfig.keySecret
    });

    await expect(harness.subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
    const beforeReject = await pttl(harness, key);
    await sleep(300);
    await expect(harness.subject.consume("site-client-a")).resolves.toMatchObject({ outcome: "limited" });
    const afterReject = await pttl(harness, key);

    expect(afterReject).toBeLessThanOrEqual(beforeReject);
  });

  async function createHarness(options: {
    readonly maxRequests: number;
    readonly windowSeconds: number;
    readonly prefix?: string;
  }): Promise<RedisHarness> {
    const config: RuntimeConfig = {
      ...runtimeConfig,
      redis: {
        url: redisUrl ?? runtimeConfig.redis.url
      },
      tenantRateLimit: {
        ...tenantRateLimitConfig,
        maxRequests: options.maxRequests,
        windowSeconds: options.windowSeconds,
        redisPrefix: options.prefix ?? uniquePrefix()
      }
    };
    const redis = new RedisService(config);
    await redis.onModuleInit();
    const store = new RedisTenantRateLimitStore(redis);
    const subject = new TenantRateLimitService(config, store);
    await subject.onModuleInit();
    const harness = { config, redis, subject };
    harnesses.push(harness);
    return harness;
  }
});

async function closeHarness(harness: RedisHarness): Promise<void> {
  const prefix = harness.config.tenantRateLimit?.redisPrefix;
  if (prefix !== undefined) {
    const keys = await harness.redis.command().call("KEYS", `${prefix}:*`);
    if (isStringArray(keys) && keys.length > 0) {
      await harness.redis.command().call("DEL", ...keys);
    }
  }

  await harness.redis.onModuleDestroy();
}

async function pttl(harness: RedisHarness, key: string): Promise<number> {
  const reply = await harness.redis.command().call("PTTL", key);
  return typeof reply === "number" ? reply : Number(reply);
}

function uniquePrefix(): string {
  return `tenant_rate_limit:test:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
