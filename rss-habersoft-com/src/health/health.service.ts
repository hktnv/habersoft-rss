import { Inject, Injectable, Optional } from "@nestjs/common";
import { DependencyState, PostgresService } from "../persistence/postgres.service";
import { RedisService } from "../redis/redis.service";
import { TENANT_AUTH_READINESS } from "../tenant-auth/tenant-auth.constants";
import { TenantAuthReadinessReport } from "../tenant-auth/tenant-auth.types";

export type ReadinessReport = {
  readonly status: "ready" | "not_ready";
  readonly dependencies: {
    readonly postgres: DependencyState;
    readonly redis: DependencyState;
    readonly tenantAuth: DependencyState;
  };
};

@Injectable()
export class HealthService {
  public constructor(
    @Inject(PostgresService)
    private readonly postgres: Pick<PostgresService, "check">,
    @Inject(RedisService)
    private readonly redis: Pick<RedisService, "check">,
    @Optional()
    @Inject(TENANT_AUTH_READINESS)
    private readonly tenantAuth?: Pick<{ readiness: () => TenantAuthReadinessReport }, "readiness">
  ) {}

  public liveness(): { readonly status: "live" } {
    return { status: "live" };
  }

  public async readiness(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.all([this.postgres.check(), this.redis.check()]);
    const tenantAuth = this.tenantAuth?.readiness().status ?? "down";
    const status = postgres === "up" && redis === "up" && tenantAuth === "up" ? "ready" : "not_ready";

    return {
      status,
      dependencies: {
        postgres,
        redis,
        tenantAuth
      }
    };
  }
}
