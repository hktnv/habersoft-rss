import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "../../src/health/health.controller";
import { HealthService } from "../../src/health/health.service";
import type { DependencyState } from "../../src/persistence/postgres.service";

function controllerWith(postgres: DependencyState, redis: DependencyState): HealthController {
  const health = new HealthService(
    {
      check: () => Promise.resolve(postgres)
    },
    {
      check: () => Promise.resolve(redis)
    }
  );

  return new HealthController(health);
}

describe("HealthController", () => {
  it("keeps liveness independent from dependencies", () => {
    const controller = controllerWith("down", "down");

    expect(controller.live()).toEqual({ status: "live" });
  });

  it("returns readiness when all dependencies are healthy", async () => {
    const controller = controllerWith("up", "up");

    await expect(controller.ready()).resolves.toEqual({
      status: "ready",
      dependencies: {
        postgres: "up",
        redis: "up"
      }
    });
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    const controller = controllerWith("down", "up");

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("returns 503 when Redis is unavailable", async () => {
    const controller = controllerWith("up", "down");

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("does not leak low-level error or secret details", async () => {
    const controller = controllerWith("down", "down");

    try {
      await controller.ready();
      throw new Error("ready unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      const serialized = JSON.stringify(response);

      expect(serialized).toContain("postgres");
      expect(serialized).toContain("redis");
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("redis://");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("ECONNREFUSED");
    }
  });
});
