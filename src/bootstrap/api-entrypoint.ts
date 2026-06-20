import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ApiModule } from "../api.module";
import { loadRuntimeConfig } from "../configuration/runtime-config";

type NestApplicationFactory = Pick<typeof NestFactory, "create">;

export async function startApi(
  env: NodeJS.ProcessEnv = process.env,
  nestFactory: NestApplicationFactory = NestFactory
): Promise<INestApplication> {
  const config = loadRuntimeConfig(env, "api");
  const app = await nestFactory.create<NestFastifyApplication>(
    ApiModule.register(config),
    new FastifyAdapter(),
    {
      bufferLogs: true
    }
  );

  app.enableShutdownHooks();
  await app.listen(config.api.port, config.api.host);

  return app;
}
