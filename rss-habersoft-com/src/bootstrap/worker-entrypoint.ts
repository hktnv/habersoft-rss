import "reflect-metadata";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadRuntimeConfig } from "../configuration/runtime-config";
import { WorkerBootstrapService } from "../worker/worker-bootstrap.service";
import { WorkerModule } from "../worker.module";

type NestContextFactory = Pick<typeof NestFactory, "createApplicationContext">;

export async function startWorker(
  env: NodeJS.ProcessEnv = process.env,
  nestFactory: NestContextFactory = NestFactory
): Promise<INestApplicationContext> {
  const config = loadRuntimeConfig(env, "worker");
  const app = await nestFactory.createApplicationContext(WorkerModule.register(config), {
    bufferLogs: true
  });

  app.enableShutdownHooks();
  await app.get(WorkerBootstrapService).assertInfrastructureReady();

  return app;
}

export function installWorkerShutdown(app: INestApplicationContext): void {
  let closing = false;

  const close = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    console.info(`main-service-worker received ${signal}`);
    await app.close();
    process.exit(0);
  };

  process.once("SIGTERM", (signal) => {
    void close(signal);
  });
  process.once("SIGINT", (signal) => {
    void close(signal);
  });
}
