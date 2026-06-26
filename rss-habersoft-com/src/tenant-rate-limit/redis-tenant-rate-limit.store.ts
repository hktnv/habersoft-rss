import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { parseIncrexReply } from "./redis-increx-reply";
import type {
  TenantRateLimitStore,
  TenantRateLimitStoreConsumeResult,
  TenantRateLimitStoreRetryResult
} from "./tenant-rate-limit.types";

@Injectable()
export class RedisTenantRateLimitStore implements TenantRateLimitStore {
  public constructor(private readonly redis: RedisService) {}

  public async consume(key: string, windowSeconds: number): Promise<TenantRateLimitStoreConsumeResult> {
    try {
      const reply = await this.redis.command().call("INCREX", key, "BYINT", 1, "EX", windowSeconds, "ENX");
      const parsed = parseIncrexReply(reply);
      return parsed.ok ? { ok: true, count: parsed.count } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  public async retryAfterSeconds(key: string): Promise<TenantRateLimitStoreRetryResult> {
    try {
      const reply = await this.redis.command().call("PTTL", key);
      const milliseconds = typeof reply === "number" ? reply : Number(reply);
      if (!Number.isInteger(milliseconds)) {
        return { ok: false };
      }

      return {
        ok: true,
        retryAfterSeconds: Math.max(1, Math.ceil(milliseconds / 1000))
      };
    } catch {
      return { ok: false };
    }
  }

  public async supportsAtomicWindowCounter(): Promise<boolean> {
    try {
      const reply = await this.redis.command().call("COMMAND", "INFO", "INCREX");
      return Array.isArray(reply) && reply.length > 0 && reply[0] !== null;
    } catch {
      return false;
    }
  }
}
