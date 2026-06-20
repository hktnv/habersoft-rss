import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";
import { DependencyState } from "../persistence/postgres.service";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  public constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    this.client = new Redis(config.redis.url, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.client.ping();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  public async check(): Promise<DependencyState> {
    try {
      const result = await this.client.ping();
      return result === "PONG" ? "up" : "down";
    } catch {
      return "down";
    }
  }

  public command(): Pick<Redis, "call"> {
    return this.client;
  }
}
