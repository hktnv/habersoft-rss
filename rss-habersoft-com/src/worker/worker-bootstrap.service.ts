import { Injectable } from "@nestjs/common";
import { PostgresService } from "../persistence/postgres.service";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class WorkerBootstrapService {
  public constructor(
    private readonly postgres: PostgresService,
    private readonly redis: RedisService
  ) {}

  public async assertInfrastructureReady(): Promise<void> {
    const [postgres, redis] = await Promise.all([this.postgres.check(), this.redis.check()]);
    const failures = [
      postgres === "down" ? "postgres" : undefined,
      redis === "down" ? "redis" : undefined
    ].filter((name): name is string => name !== undefined);

    if (failures.length > 0) {
      throw new Error(`Worker dependencies are not ready: ${failures.join(", ")}`);
    }
  }
}
