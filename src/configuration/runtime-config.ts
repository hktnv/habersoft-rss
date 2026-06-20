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
  readonly tenantAuth?: TenantAuthConfig;
  readonly tenantRateLimit?: TenantRateLimitConfig;
  readonly agentAuth?: AgentAuthConfig;
  readonly agentEntries?: AgentEntriesConfig;
};

export type TenantAuthConfig = {
  readonly jwksUrl: string;
  readonly issuer: "https://auth.habersoft.com";
  readonly audience: "rss.habersoft.com";
  readonly requiredScope: "services:access";
  readonly algorithm: "RS256";
  readonly clockToleranceSeconds: 30;
  readonly refreshIntervalMs: 300000;
  readonly httpTimeoutMs: 2000;
  readonly maxResponseBytes: 65536;
};

export type TenantRateLimitConfig = {
  readonly maxRequests: number;
  readonly windowSeconds: number;
  readonly redisPrefix: string;
  readonly keySecret: string;
};

export type AgentAuthConfig = {
  readonly key: string;
};

export type AgentEntriesConfig = {
  readonly checkedAtMaxFutureSkewSeconds: number;
  readonly checkedAtMaxAgeSeconds: number;
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
export const localAgentKeyPlaceholder = "replace_with_local_only_agent_key_at_least_32_bytes";

export function loadRuntimeConfig(env: RawEnvironment, expectedRole: RuntimeRole): RuntimeConfig {
  const issues: string[] = [];

  const role = requireEnum(env.RUNTIME_ROLE, "RUNTIME_ROLE", runtimeRoles, issues);
  const environment = requireEnum(env.APP_ENV, "APP_ENV", appEnvironments, issues);
  const logLevel = requireEnum(env.LOG_LEVEL, "LOG_LEVEL", logLevels, issues);
  const apiHost = requireText(env.API_BIND_HOST, "API_BIND_HOST", issues);
  const apiPort = requirePort(env.API_PORT, "API_PORT", issues);
  const databaseUrl = requireUrl(env.DATABASE_URL, "DATABASE_URL", ["postgresql:"], issues);
  const redisUrl = requireUrl(env.REDIS_URL, "REDIS_URL", ["redis:", "rediss:"], issues);
  const tenantAuth =
    expectedRole === "api" ? requireTenantAuthConfig(env.TENANT_AUTH_JWKS_URL, environment, issues) : undefined;
  const tenantRateLimit =
    expectedRole === "api"
      ? requireTenantRateLimitConfig(
          {
            maxRequests: env.TENANT_RATE_LIMIT_MAX_REQUESTS,
            windowSeconds: env.TENANT_RATE_LIMIT_WINDOW_SECONDS,
            redisPrefix: env.TENANT_RATE_LIMIT_REDIS_PREFIX,
            keySecret: env.TENANT_RATE_LIMIT_KEY_SECRET
          },
          environment,
          issues
        )
      : undefined;
  const agentAuth =
    expectedRole === "api" ? requireAgentAuthConfig(env.AGENT_KEY, environment, issues) : undefined;
  const agentEntries =
    expectedRole === "api"
      ? requireAgentEntriesConfig(
          {
            checkedAtMaxFutureSkewSeconds: env.CHECKED_AT_MAX_FUTURE_SKEW_SECONDS,
            checkedAtMaxAgeSeconds: env.CHECKED_AT_MAX_AGE_SECONDS
          },
          issues
        )
      : undefined;

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
    },
    ...(tenantAuth === undefined ? {} : { tenantAuth }),
    ...(tenantRateLimit === undefined ? {} : { tenantRateLimit }),
    ...(agentAuth === undefined ? {} : { agentAuth }),
    ...(agentEntries === undefined ? {} : { agentEntries })
  };
}

function requireTenantAuthConfig(
  value: string | undefined,
  environment: AppEnvironment | undefined,
  issues: string[]
): TenantAuthConfig {
  const jwksUrl = requireUrl(value, "TENANT_AUTH_JWKS_URL", ["https:", "http:"], issues);

  if (jwksUrl !== "") {
    try {
      const parsed = new URL(jwksUrl);
      const production = environment === "production";
      const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "tenant-auth-jwks-fixture"]);

      if (production && parsed.protocol !== "https:") {
        issues.push("TENANT_AUTH_JWKS_URL must use HTTPS in production");
      }

      if (production && localHostnames.has(parsed.hostname)) {
        issues.push("TENANT_AUTH_JWKS_URL must not target a local fixture in production");
      }
    } catch {
      // requireUrl already records the malformed URL issue.
    }
  }

  return {
    jwksUrl,
    issuer: "https://auth.habersoft.com",
    audience: "rss.habersoft.com",
    requiredScope: "services:access",
    algorithm: "RS256",
    clockToleranceSeconds: 30,
    refreshIntervalMs: 300000,
    httpTimeoutMs: 2000,
    maxResponseBytes: 65536
  };
}

function requireTenantRateLimitConfig(
  values: {
    readonly maxRequests: string | undefined;
    readonly windowSeconds: string | undefined;
    readonly redisPrefix: string | undefined;
    readonly keySecret: string | undefined;
  },
  environment: AppEnvironment | undefined,
  issues: string[]
): TenantRateLimitConfig {
  const maxRequests = requirePositiveInteger(values.maxRequests, "TENANT_RATE_LIMIT_MAX_REQUESTS", issues);
  const windowSeconds = requirePositiveInteger(values.windowSeconds, "TENANT_RATE_LIMIT_WINDOW_SECONDS", issues);
  const redisPrefix = requireText(values.redisPrefix, "TENANT_RATE_LIMIT_REDIS_PREFIX", issues);
  const keySecret = requireText(values.keySecret, "TENANT_RATE_LIMIT_KEY_SECRET", issues);

  if (redisPrefix !== "" && !/^[a-z0-9:_-]+$/u.test(redisPrefix)) {
    issues.push("TENANT_RATE_LIMIT_REDIS_PREFIX may contain only lowercase letters, digits, colon, underscore, and hyphen");
  }

  if (environment === "production") {
    if (keySecret.length < 32) {
      issues.push("TENANT_RATE_LIMIT_KEY_SECRET must be at least 32 characters in production");
    }

    if (keySecret.includes("replace_with") || keySecret.includes("local_only")) {
      issues.push("TENANT_RATE_LIMIT_KEY_SECRET must be explicit in production");
    }
  }

  return {
    maxRequests,
    windowSeconds,
    redisPrefix,
    keySecret
  };
}

function requireAgentAuthConfig(
  value: string | undefined,
  environment: AppEnvironment | undefined,
  issues: string[]
): AgentAuthConfig {
  const key = requireText(value, "AGENT_KEY", issues);

  if (key !== "") {
    if (key.trim() !== key) {
      issues.push("AGENT_KEY must not include leading or trailing whitespace");
    }

    if (Buffer.byteLength(key, "utf8") < 32) {
      issues.push("AGENT_KEY must be at least 32 UTF-8 bytes");
    }

    if (containsAsciiControlCharacter(key)) {
      issues.push("AGENT_KEY must not contain ASCII control characters");
    }

    if (
      environment === "production" &&
      (key === localAgentKeyPlaceholder || key.includes("replace_with") || key.includes("local_only"))
    ) {
      issues.push("AGENT_KEY must be explicit in production");
    }
  }

  return { key };
}

function requireAgentEntriesConfig(
  values: {
    readonly checkedAtMaxFutureSkewSeconds: string | undefined;
    readonly checkedAtMaxAgeSeconds: string | undefined;
  },
  issues: string[]
): AgentEntriesConfig {
  return {
    checkedAtMaxFutureSkewSeconds: requirePositiveInteger(
      values.checkedAtMaxFutureSkewSeconds,
      "CHECKED_AT_MAX_FUTURE_SKEW_SECONDS",
      issues
    ),
    checkedAtMaxAgeSeconds: requirePositiveInteger(values.checkedAtMaxAgeSeconds, "CHECKED_AT_MAX_AGE_SECONDS", issues)
  };
}

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && ((codePoint >= 0 && codePoint <= 31) || codePoint === 127)) {
      return true;
    }
  }

  return false;
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

function requirePositiveInteger(value: string | undefined, name: string, issues: string[]): number {
  const text = requireText(value, name, issues);
  const parsed = Number(text);

  if (!Number.isInteger(parsed) || parsed < 1) {
    issues.push(`${name} must be a positive integer`);
    return 0;
  }

  return parsed;
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
