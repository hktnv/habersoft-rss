import { Inject, Injectable } from "@nestjs/common";
import { DependencyState, PostgresService } from "../persistence/postgres.service";
import { RedisService } from "../redis/redis.service";

export type ReadinessReport = {
  readonly status: "ready" | "not_ready";
  readonly dependencies: {
    readonly postgres: DependencyState;
    readonly redis: DependencyState;
  };
};

@Injectable()
export class HealthService {
  public constructor(
    @Inject(PostgresService)
    private readonly postgres: Pick<PostgresService, "check">,
    @Inject(RedisService)
    private readonly redis: Pick<RedisService, "check">
  ) {}

  public liveness(): { readonly status: "live" } {
    return { status: "live" };
  }

  public async readiness(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.all([this.postgres.check(), this.redis.check()]);
    const status = postgres === "up" && redis === "up" ? "ready" : "not_ready";

    return {
      status,
      dependencies: {
        postgres,
        redis
      }
    };
  }
}
