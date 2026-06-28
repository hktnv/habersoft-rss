import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const image =
  process.env.RSS_ADMIN_UI_READINESS_IMAGE ??
  process.env.RSS_ADMIN_UI_TEST_IMAGE ??
  "rss-admin-ui:ms021b-local";
const productionHostPattern = /(?:^|[/:.])rss-panel\.habersoft\.com(?:$|[/:])/iu;
const invalidOrigins = [
  "ftp://sentinel:3100",
  "http://user:pass@sentinel:3100",
  "http://sentinel:3100/health",
  "http://sentinel:3100?target=/health/live",
  "http://sentinel:3100#fragment",
  "http://sentinel:abc",
  "http://sentinel:70000",
  "http://sentinel:3100;touch-ms021b"
];

const rootComposeEnv = {
  RSS_HABERSOFT_COM_IMAGE: "habersoft-rss-backend:ms021b-local",
  RSS_ADMIN_UI_IMAGE: image,
  ADMIN_UI_HOST_PORT: "8081",
  ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://main-service-api:3000",
  ADMIN_UI_ENVIRONMENT_NAME: "production-readiness-local",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  POSTGRES_DB: "rss_habersoft",
  DATABASE_URL: "postgresql://postgres:postgres@postgres:5432/rss_habersoft?schema=public",
  REDIS_URL: "redis://redis:6379/0"
};
const productionComposeEnv = {
  RSS_ADMIN_UI_IMAGE: "rss-admin-ui@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: "http://127.0.0.1:3200",
  ADMIN_UI_ENVIRONMENT_NAME: "production-readiness-local",
  ADMIN_UI_HOST_PORT: "8081"
};

console.log(JSON.stringify({ status: "production-readiness-verify-start", image }, null, 2));

run("node", ["--version"]);
run("npm", ["--version"]);
run("docker", ["version", "--format", "{{.Server.Version}}"], { cwd: repoRoot });
assertNoProductionContactEnv(rootComposeEnv);
assertNoProductionContactEnv(productionComposeEnv);

run("npm", ["run", "build"]);
run("docker", ["build", "-t", image, "."], { printOutput: false, timeoutMs: 600000 });
console.log(JSON.stringify({ status: "docker-build-ok", image }));

expectContainerStartupFailure("missing ADMIN_UI_HEALTH_UPSTREAM_ORIGIN", {});
for (const origin of invalidOrigins) {
  expectContainerStartupFailure(`invalid ADMIN_UI_HEALTH_UPSTREAM_ORIGIN=${origin}`, {
    ADMIN_UI_HEALTH_UPSTREAM_ORIGIN: origin
  });
}

run("docker", ["compose", "config", "--quiet"], {
  cwd: repoRoot,
  env: rootComposeEnv
});
run("docker", ["compose", "-f", path.join("deploy", "production", "compose.yaml"), "config", "--quiet"], {
  env: productionComposeEnv
});

run("npm", ["run", "test:proxy-security"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});
run("npm", ["run", "test:auth-session-sentinel"], {
  env: { RSS_ADMIN_UI_TEST_IMAGE: image },
  timeoutMs: 600000
});

console.log(
  JSON.stringify(
    {
      status: "production-readiness-verify-ok",
      image,
      checks: [
        "production build exists",
        "docker image builds",
        "missing upstream origin fails closed",
        "invalid upstream origins fail closed",
        "safe synthetic upstream accepted",
        "healthz and static app served",
        "browser config excludes upstream origin and API base",
        "exact health route proxy security passes",
        "same-origin admin session sentinel fails closed",
        "root compose config passes with synthetic values",
        "frontend production compose config passes with synthetic values",
        "no production hostname used by verifier command environments"
      ]
    },
    null,
    2
  )
);

function expectContainerStartupFailure(label, env) {
  const result = run("docker", ["run", "--rm", ...toEnvArgs(env), image], {
    env,
    allowFailure: true,
    printOutput: false,
    timeoutMs: 120000
  });
  if (result.status === 0) {
    throw new Error(`expected container startup failure for ${label}`);
  }
  console.log(JSON.stringify({ status: "fail-closed-ok", case: label }));
}

function assertNoProductionContactEnv(env) {
  for (const [name, value] of Object.entries(env)) {
    if (productionHostPattern.test(String(value))) {
      throw new Error(`production hostname is not allowed in local verifier env: ${name}`);
    }
  }
}

function toEnvArgs(env) {
  return Object.entries(env).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args);
  const env = { ...process.env, ...(options.env ?? {}) };
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: options.cwd ?? frontendRoot,
    env,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 120000
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (options.printOutput !== false && stdout.trim() !== "") process.stdout.write(stdout);
  if (options.printOutput !== false && stderr.trim() !== "") process.stderr.write(stderr);

  if (result.error !== undefined) {
    throw result.error;
  }

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
  return result;
}

function resolveCommand(command, args) {
  if (command === "npm" && process.env.npm_execpath !== undefined) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { executable: command, args };
}
