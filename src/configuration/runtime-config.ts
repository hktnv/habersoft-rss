export type RuntimeRole = "api" | "worker";
export type AppEnvironment = "local" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type RuntimeConfig = {
  readonly role: RuntimeRole;
  readonly environment: AppEnvironment;
  readonly logLevel: LogLevel;
  readonly api: {
    readonly host: string;
    readonly port: number;
  };
  readonly postgres: {
    readonly url: string;
  };
  readonly redis: {
    readonly url: string;
  };
};

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid runtime configuration: ${issues.join("; ")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

type RawEnvironment = Record<string, string | undefined>;

const appEnvironments = new Set<AppEnvironment>(["local", "test", "production"]);
const logLevels = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const runtimeRoles = new Set<RuntimeRole>(["api", "worker"]);

export function loadRuntimeConfig(env: RawEnvironment, expectedRole: RuntimeRole): RuntimeConfig {
  const issues: string[] = [];

  const role = requireEnum(env.RUNTIME_ROLE, "RUNTIME_ROLE", runtimeRoles, issues);
  const environment = requireEnum(env.APP_ENV, "APP_ENV", appEnvironments, issues);
  const logLevel = requireEnum(env.LOG_LEVEL, "LOG_LEVEL", logLevels, issues);
  const apiHost = requireText(env.API_BIND_HOST, "API_BIND_HOST", issues);
  const apiPort = requirePort(env.API_PORT, "API_PORT", issues);
  const databaseUrl = requireUrl(env.DATABASE_URL, "DATABASE_URL", ["postgresql:"], issues);
  const redisUrl = requireUrl(env.REDIS_URL, "REDIS_URL", ["redis:", "rediss:"], issues);

  if (role !== undefined && role !== expectedRole) {
    issues.push(`RUNTIME_ROLE must be ${expectedRole}`);
  }

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  return {
    role,
    environment,
    logLevel,
    api: {
      host: apiHost,
      port: apiPort
    },
    postgres: {
      url: databaseUrl
    },
    redis: {
      url: redisUrl
    }
  };
}

function requireText(value: string | undefined, name: string, issues: string[]): string {
  if (value === undefined || value.trim() === "") {
    issues.push(`${name} is required`);
    return "";
  }

  return value;
}

function requireEnum<T extends string>(
  value: string | undefined,
  name: string,
  allowed: ReadonlySet<T>,
  issues: string[]
): T {
  const text = requireText(value, name, issues);

  if (text !== "" && !allowed.has(text as T)) {
    issues.push(`${name} is invalid`);
  }

  return text as T;
}

function requirePort(value: string | undefined, name: string, issues: string[]): number {
  const text = requireText(value, name, issues);
  const port = Number(text);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push(`${name} must be an integer between 1 and 65535`);
    return 0;
  }

  return port;
}

function requireUrl(
  value: string | undefined,
  name: string,
  allowedProtocols: readonly string[],
  issues: string[]
): string {
  const text = requireText(value, name, issues);

  if (text === "") {
    return "";
  }

  try {
    const parsed = new URL(text);
    if (!allowedProtocols.includes(parsed.protocol)) {
      issues.push(`${name} uses an unsupported protocol`);
    }
  } catch {
    issues.push(`${name} must be a valid URL`);
  }

  return text;
}
