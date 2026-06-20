import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";

export type DependencyState = "up" | "down";

@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  public constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    this.client = new PrismaClient({
      datasources: {
        db: {
          url: config.postgres.url
        }
      }
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  public async check(): Promise<DependencyState> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return "up";
    } catch {
      return "down";
    }
  }
}
