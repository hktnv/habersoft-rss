import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import type { RuntimeConfig } from "../configuration/runtime-config";
import { deriveTenantRateLimitKey } from "./tenant-rate-limit.key-derivation";
import { TENANT_RATE_LIMIT_STORE } from "./tenant-rate-limit.store";
import type { TenantRateLimitConsumeResult, TenantRateLimitStore } from "./tenant-rate-limit.types";

@Injectable()
export class TenantRateLimitService implements OnModuleInit {
  private supported = false;

  public constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(TENANT_RATE_LIMIT_STORE) private readonly store: TenantRateLimitStore
  ) {}

  public async onModuleInit(): Promise<void> {
    this.supported = await this.store.supportsAtomicWindowCounter();
  }

  public async consume(tenantIdentifier: string): Promise<TenantRateLimitConsumeResult> {
    const rateLimit = this.config.tenantRateLimit;
    if (rateLimit === undefined || !this.supported) {
      return { outcome: "unavailable" };
    }

    const key = deriveTenantRateLimitKey({
      tenantIdentifier,
      redisPrefix: rateLimit.redisPrefix,
      keySecret: rateLimit.keySecret
    });

    const consumed = await this.store.consume(key, rateLimit.windowSeconds);
    if (!consumed.ok) {
      return { outcome: "unavailable" };
    }

    if (consumed.count <= rateLimit.maxRequests) {
      return { outcome: "allowed" };
    }

    const retry = await this.store.retryAfterSeconds(key);
    if (!retry.ok) {
      return { outcome: "unavailable" };
    }

    return {
      outcome: "limited",
      retryAfterSeconds: retry.retryAfterSeconds
    };
  }
}
