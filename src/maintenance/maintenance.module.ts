import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module";
import { RedisRuntimeModule } from "../redis/redis-runtime.module";
import { WorkerBootstrapService } from "../worker/worker-bootstrap.service";
import { CleanupOrchestrator } from "./cleanup.orchestrator";
import { CleanupPostgresExecutor } from "./cleanup.postgres-executor";
import { CleanupTelemetry } from "./cleanup.telemetry";
import { MaintenanceQueueRunner } from "./maintenance.queue-runner";

@Module({
  imports: [PersistenceModule, RedisRuntimeModule],
  providers: [
    WorkerBootstrapService,
    CleanupTelemetry,
    CleanupPostgresExecutor,
    {
      provide: "CLEANUP_STEP_EXECUTOR",
      useExisting: CleanupPostgresExecutor
    },
    {
      provide: CleanupOrchestrator,
      useFactory: (executor: CleanupPostgresExecutor, telemetry: CleanupTelemetry) =>
        new CleanupOrchestrator(executor, telemetry),
      inject: [CleanupPostgresExecutor, CleanupTelemetry]
    },
    MaintenanceQueueRunner
  ],
  exports: [MaintenanceQueueRunner, WorkerBootstrapService]
})
export class MaintenanceModule {}
