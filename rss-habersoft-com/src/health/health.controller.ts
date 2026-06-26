import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthService, ReadinessReport } from "./health.service";

@Controller("health")
export class HealthController {
  public constructor(private readonly health: HealthService) {}

  @Get("live")
  public live(): { readonly status: "live" } {
    return this.health.liveness();
  }

  @Get("ready")
  public async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();

    if (report.status === "ready") {
      return report;
    }

    throw new ServiceUnavailableException(report);
  }
}
