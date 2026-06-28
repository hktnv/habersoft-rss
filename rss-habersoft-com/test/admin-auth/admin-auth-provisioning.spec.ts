import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { verifyAdminPasswordHash } from "../../src/admin-auth/admin-password-hash";
import { loadRuntimeConfig, localAgentKeyPlaceholder } from "../../src/configuration/runtime-config";

const backendRoot = path.resolve(__dirname, "..", "..");
const provisioningScript = path.join(backendRoot, "scripts", "admin-auth-provisioning.mjs");

describe("admin auth provisioning helpers", () => {
  it("generates a PBKDF2 hash that verifies through the backend admin auth verifier", () => {
    const password = "synthetic-ms022b-admin-password";
    const result = runProvisioning(["hash", "--emit-sensitive-output"], {
      ADMIN_UI_ADMIN_PASSWORD: password
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).toBe("");

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "admin-auth-password-hash-generated",
      algorithm: "pbkdf2-sha256",
      iterations: 120000,
      salt_bytes: 16,
      key_bytes: 32
    });
    const generatedHash = body.password_hash;
    expect(typeof generatedHash).toBe("string");
    expect(verifyAdminPasswordHash(password, generatedHash as string)).toBe(true);
  });

  it("verifies a generated hash without echoing password or hash material", () => {
    const password = "synthetic-ms022b-admin-password";
    const hashResult = runProvisioning(["hash", "--emit-sensitive-output"], {
      ADMIN_UI_ADMIN_PASSWORD: password
    });
    const hash = parseJson(hashResult.stdout).password_hash as string;

    const result = runProvisioning(["hash", "--verify"], {
      ADMIN_UI_ADMIN_PASSWORD: password,
      ADMIN_UI_ADMIN_PASSWORD_HASH: hash
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("admin-auth-password-hash-verify-ok");
    expect(result.stdout).not.toContain(password);
    expect(result.stdout).not.toContain(hash);
  });

  it("generates a session secret compatible with backend runtime config validation", () => {
    const result = runProvisioning(["secret", "--emit-sensitive-output"]);

    expect(result.status).toBe(0);
    const body = parseJson(result.stdout);
    expect(body.status).toBe("admin-auth-session-secret-generated");
    const sessionSecret = body.session_secret as string;
    expect(typeof sessionSecret).toBe("string");
    expect(Buffer.byteLength(sessionSecret, "utf8")).toBeGreaterThanOrEqual(32);

    const passwordHash = parseJson(
      runProvisioning(["hash", "--emit-sensitive-output"], {
        ADMIN_UI_ADMIN_PASSWORD: "synthetic-ms022b-admin-password"
      }).stdout
    ).password_hash as string;

    const config = loadRuntimeConfig(
      productionRuntimeEnv({
        ADMIN_UI_ADMIN_PASSWORD_HASH: passwordHash,
        ADMIN_UI_SESSION_SECRET: sessionSecret
      }),
      "api"
    );

    expect(config.adminAuth).toMatchObject({
      mode: "single_admin",
      username: "admin",
      sessionCookieSecure: true,
      redisPrefix: "admin_auth:production"
    });
  });

  it("validates synthetic production activation config without printing sensitive values", () => {
    const result = runProvisioning(["verify-config", "--synthetic", "--require-enabled"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("admin-auth-config-verify-ok");
    expect(result.stdout).toContain("redacted");
    expect(result.stdout).not.toContain("synthetic-ms022b-admin-password");
    expect(result.stdout).not.toContain("synthetic_ms022b_admin_session_secret");
  });

  it("fails closed for malformed production config without echoing submitted secret values", () => {
    const badHash = "plaintext-password";
    const badSecret = "short-secret";
    const result = runProvisioning(["verify-config", "--require-enabled"], {
      APP_ENV: "production",
      ADMIN_UI_AUTH_MODE: "single_admin",
      ADMIN_UI_ADMIN_USERNAME: " admin ",
      ADMIN_UI_ADMIN_PASSWORD_HASH: badHash,
      ADMIN_UI_SESSION_SECRET: badSecret,
      ADMIN_UI_SESSION_COOKIE_SECURE: "false",
      ADMIN_UI_SESSION_REDIS_PREFIX: "Admin Auth"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ADMIN_UI_ADMIN_PASSWORD_HASH");
    expect(result.stderr).toContain("ADMIN_UI_SESSION_SECRET");
    expect(result.stderr).toContain("ADMIN_UI_SESSION_COOKIE_SECURE");
    expect(result.stderr).not.toContain(badHash);
    expect(result.stderr).not.toContain(badSecret);
  });
});

function runProvisioning(
  args: readonly string[],
  env: Record<string, string | undefined> = {}
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  return spawnSync(process.execPath, [provisioningScript, ...args], {
    cwd: backendRoot,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8",
    shell: false
  });
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

function productionRuntimeEnv(
  values: Pick<Record<string, string>, "ADMIN_UI_ADMIN_PASSWORD_HASH" | "ADMIN_UI_SESSION_SECRET">
): Record<string, string> {
  return {
    APP_ENV: "production",
    LOG_LEVEL: "info",
    RUNTIME_ROLE: "api",
    API_BIND_HOST: "0.0.0.0",
    API_PORT: "3000",
    DATABASE_URL: "postgresql://main_service:password@postgres:5432/main_service?schema=public",
    REDIS_URL: "redis://redis:6379/0",
    TENANT_AUTH_JWKS_URL: "https://auth.habersoft.com/.well-known/jwks.json",
    TENANT_RATE_LIMIT_MAX_REQUESTS: "60",
    TENANT_RATE_LIMIT_WINDOW_SECONDS: "60",
    TENANT_RATE_LIMIT_REDIS_PREFIX: "tenant_rate_limit:production",
    TENANT_RATE_LIMIT_KEY_SECRET: "production_rate_limit_key_secret_32",
    AGENT_KEY: "production_agent_key_secret_at_least_32_bytes",
    CHECKED_AT_MAX_FUTURE_SKEW_SECONDS: "60",
    CHECKED_AT_MAX_AGE_SECONDS: "900",
    ADMIN_UI_AUTH_MODE: "single_admin",
    ADMIN_UI_ADMIN_USERNAME: "admin",
    ADMIN_UI_ADMIN_PASSWORD_HASH: values.ADMIN_UI_ADMIN_PASSWORD_HASH,
    ADMIN_UI_SESSION_SECRET: values.ADMIN_UI_SESSION_SECRET,
    ADMIN_UI_SESSION_TTL_SECONDS: "900",
    ADMIN_UI_SESSION_COOKIE_NAME: "habersoft_admin_session",
    ADMIN_UI_SESSION_COOKIE_SECURE: "true",
    ADMIN_UI_SESSION_REDIS_PREFIX: "admin_auth:production",
    AGENT_KEY_PLACEHOLDER_GUARD: localAgentKeyPlaceholder
  };
}
