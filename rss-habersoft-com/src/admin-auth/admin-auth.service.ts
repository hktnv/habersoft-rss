import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RuntimeConfig, type AdminAuthConfig } from "../configuration/runtime-config";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RedisService } from "../redis/redis.service";
import { verifyAdminPasswordHash } from "./admin-password-hash";
import { AdminLoginRateLimiter } from "./admin-login-rate-limiter.service";

export type AdminSessionResponse =
  | {
      readonly configured: false;
      readonly authenticated: false;
      readonly status: "not_configured";
      readonly reason: "not_configured";
      readonly message: string;
    }
  | {
      readonly configured: true;
      readonly authenticated: false;
      readonly reason: "unauthenticated" | "logged_out";
    }
  | {
      readonly configured: true;
      readonly authenticated: true;
      readonly principal: {
        readonly kind: "single_admin";
        readonly displayName: "Admin";
      };
      readonly expiresAt: string;
    };

export type AdminCookieMutation =
  | {
      readonly kind: "set";
      readonly cookies: readonly string[];
    }
  | {
      readonly kind: "clear";
      readonly cookies: readonly string[];
    }
  | {
      readonly kind: "none";
    };

type AdminSessionRecord = {
  readonly kind: "single_admin";
  readonly createdAt: string;
  readonly expiresAt: string;
};

const disabledAdminAuthConfig: AdminAuthConfig = { mode: "disabled" };

@Injectable()
export class AdminAuthService {
  private readonly config: AdminAuthConfig;

  public constructor(
    @Inject(RUNTIME_CONFIG) runtimeConfig: RuntimeConfig,
    private readonly redis: RedisService,
    private readonly limiter: AdminLoginRateLimiter
  ) {
    this.config = runtimeConfig.adminAuth ?? disabledAdminAuthConfig;
  }

  public async session(request: FastifyRequest): Promise<AdminSessionResponse> {
    if (this.config.mode === "disabled") {
      return notConfiguredResponse();
    }

    const sessionId = readCookie(request.headers.cookie, this.config.sessionCookieName);
    if (sessionId === undefined || !isSessionToken(sessionId)) {
      return unauthenticatedResponse();
    }

    const record = await this.readSession(sessionId);
    if (record === undefined) {
      return unauthenticatedResponse();
    }

    return authenticatedResponse(record.expiresAt);
  }

  public async login(
    request: FastifyRequest,
    body: unknown
  ): Promise<{ readonly response: AdminSessionResponse; readonly cookie: AdminCookieMutation }> {
    if (this.config.mode === "disabled") {
      throw new ServiceUnavailableException(notConfiguredResponse());
    }

    const login = parseLoginBody(body);
    if (login === undefined) {
      throw new UnauthorizedException(unauthenticatedResponse());
    }

    const limiterKey = loginRateLimitKey(request, login.username);
    this.limiter.assertAllowed(limiterKey);

    if (!constantTimeStringEquals(login.username, this.config.username)) {
      this.limiter.recordFailure(limiterKey);
      throw new UnauthorizedException(unauthenticatedResponse());
    }

    const passwordOk = verifyAdminPasswordHash(login.password, this.config.passwordHash);
    if (!passwordOk) {
      this.limiter.recordFailure(limiterKey);
      throw new UnauthorizedException(unauthenticatedResponse());
    }

    this.limiter.recordSuccess(limiterKey);
    const now = new Date();
    const sessionId = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString();
    await this.writeSession(sessionId, {
      kind: "single_admin",
      createdAt: now.toISOString(),
      expiresAt
    });

    return {
      response: authenticatedResponse(expiresAt),
      cookie: {
        kind: "set",
        cookies: [
          buildSessionCookie(this.config, sessionId, this.config.sessionTtlSeconds),
          buildClearSessionCookie(this.config, "/admin-auth")
        ]
      }
    };
  }

  public async logout(request: FastifyRequest): Promise<{ readonly response: AdminSessionResponse; readonly cookie: AdminCookieMutation }> {
    if (this.config.mode === "disabled") {
      return {
        response: notConfiguredResponse(),
        cookie: { kind: "none" }
      };
    }

    const sessionId = readCookie(request.headers.cookie, this.config.sessionCookieName);
    if (sessionId !== undefined && isSessionToken(sessionId)) {
      await this.deleteSession(sessionId);
    }

    return {
      response: {
        configured: true,
        authenticated: false,
        reason: "logged_out"
      },
      cookie: {
        kind: "clear",
        cookies: buildClearSessionCookies(this.config)
      }
    };
  }

  private async writeSession(sessionId: string, record: AdminSessionRecord): Promise<void> {
    if (this.config.mode !== "single_admin") return;
    await this.redis.command().call("SET", this.sessionKey(sessionId), JSON.stringify(record), "EX", this.config.sessionTtlSeconds);
  }

  private async readSession(sessionId: string): Promise<AdminSessionRecord | undefined> {
    if (this.config.mode !== "single_admin") return undefined;

    const result = await this.redis.command().call("GET", this.sessionKey(sessionId));
    if (typeof result !== "string") return undefined;

    try {
      const parsed = JSON.parse(result) as AdminSessionRecord;
      if (parsed.kind !== "single_admin" || typeof parsed.expiresAt !== "string") {
        return undefined;
      }

      if (Date.parse(parsed.expiresAt) <= Date.now()) {
        await this.deleteSession(sessionId);
        return undefined;
      }

      return parsed;
    } catch {
      return undefined;
    }
  }

  private async deleteSession(sessionId: string): Promise<void> {
    if (this.config.mode !== "single_admin") return;
    await this.redis.command().call("DEL", this.sessionKey(sessionId));
  }

  private sessionKey(sessionId: string): string {
    if (this.config.mode !== "single_admin") {
      return "";
    }

    const digest = createHmac("sha256", this.config.sessionSecret).update(sessionId, "utf8").digest("base64url");
    return `${this.config.redisPrefix}:${digest}`;
  }
}

function notConfiguredResponse(): AdminSessionResponse {
  return {
    configured: false,
    authenticated: false,
    status: "not_configured",
    reason: "not_configured",
    message: "Admin authentication is not configured."
  };
}

function unauthenticatedResponse(): AdminSessionResponse {
  return {
    configured: true,
    authenticated: false,
    reason: "unauthenticated"
  };
}

function authenticatedResponse(expiresAt: string): AdminSessionResponse {
  return {
    configured: true,
    authenticated: true,
    principal: {
      kind: "single_admin",
      displayName: "Admin"
    },
    expiresAt
  };
}

function parseLoginBody(body: unknown): { readonly username: string; readonly password: string } | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.username !== "string" || typeof record.password !== "string") return undefined;
  if (record.username.length < 1 || record.username.length > 128) return undefined;
  if (record.password.length < 1 || record.password.length > 4096) return undefined;

  return {
    username: record.username,
    password: record.password
  };
}

function loginRateLimitKey(request: FastifyRequest, username: string): string {
  return `${request.ip ?? "unknown"}:${username.toLowerCase()}`;
}

function constantTimeStringEquals(candidate: string, expected: string): boolean {
  const candidateDigest = createHmac("sha256", "admin-auth-username").update(candidate, "utf8").digest();
  const expectedDigest = createHmac("sha256", "admin-auth-username").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }

  return undefined;
}

function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/u.test(value);
}

function buildSessionCookie(config: Extract<AdminAuthConfig, { readonly mode: "single_admin" }>, value: string, maxAge: number): string {
  const parts = [
    `${config.sessionCookieName}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (config.sessionCookieSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildClearSessionCookies(config: Extract<AdminAuthConfig, { readonly mode: "single_admin" }>): readonly string[] {
  return [buildClearSessionCookie(config, "/"), buildClearSessionCookie(config, "/admin-auth")];
}

function buildClearSessionCookie(config: Extract<AdminAuthConfig, { readonly mode: "single_admin" }>, path: "/" | "/admin-auth"): string {
  const parts = [
    `${config.sessionCookieName}=`,
    `Path=${path}`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (config.sessionCookieSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

