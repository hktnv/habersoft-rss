import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  AGENT_ENTRIES_BODY_LIMIT_BYTES,
  DEFAULT_FASTIFY_BODY_LIMIT_BYTES
} from "../agent-entries/agent-entries.policy";
import { AGENT_FEED_CHECK_RESULTS_BODY_LIMIT_BYTES } from "../agent-feed-check-results/agent-feed-check-results.policy";
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
    new FastifyAdapter({ bodyLimit: AGENT_ENTRIES_BODY_LIMIT_BYTES }),
    {
      bufferLogs: true
    }
  );

  configureApiBodyLimits(app);
  app.enableShutdownHooks();
  await app.listen(config.api.port, config.api.host);

  return app;
}

export function configureApiBodyLimits(app: NestFastifyApplication): void {
  app.getHttpAdapter().getInstance().addHook("onRequest", (request, reply, done) => {
    const contentLength = readContentLength(request.raw.headers["content-length"]);
    if (contentLength === undefined || request.raw.method !== "POST") {
      done();
      return;
    }

    const path = request.raw.url?.split("?", 1)[0] ?? "";
    const limit =
      path === "/agent/entries"
        ? AGENT_ENTRIES_BODY_LIMIT_BYTES
        : path === "/agent/feed-check-results"
          ? AGENT_FEED_CHECK_RESULTS_BODY_LIMIT_BYTES
          : DEFAULT_FASTIFY_BODY_LIMIT_BYTES;

    if (contentLength > limit) {
      reply.code(413).send({ error_code: "REQUEST_BODY_TOO_LARGE" });
      return;
    }

    done();
  });
}

function readContentLength(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (text === undefined || !/^[0-9]+$/u.test(text)) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
