import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";
import { JwksHttpClient } from "./jwks-http.client";
import type { JwksFetcher } from "./jwks-http.client";
import { loadJoseRuntime } from "./jose-runtime";
import { NodeTimerScheduler, ScheduledTask, TimerScheduler } from "./timer-scheduler";
import {
  JwksKeySet,
  JwksVerificationKey,
  TenantAuthFailureReason,
  TenantAuthReadinessReport
} from "./tenant-auth.types";

export const TIMER_SCHEDULER = Symbol("TIMER_SCHEDULER");

@Injectable()
export class JwksCacheService implements OnModuleInit, OnModuleDestroy {
  private current: JwksKeySet | undefined;
  private refreshTask: ScheduledTask | undefined;
  private refreshPromise: Promise<TenantAuthFailureReason | null> | undefined;
  private lastFailureReason: TenantAuthFailureReason | null = null;

  public constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(JwksHttpClient)
    private readonly client: JwksFetcher,
    @Inject(TIMER_SCHEDULER) private readonly scheduler: TimerScheduler = new NodeTimerScheduler()
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.refresh();
    const interval = this.config.tenantAuth?.refreshIntervalMs ?? 300000;
    this.refreshTask = this.scheduler.scheduleRepeating(() => {
      void this.refresh();
    }, interval);
  }

  public onModuleDestroy(): void {
    this.refreshTask?.cancel();
    this.refreshTask = undefined;
  }

  public readiness(): TenantAuthReadinessReport {
    const current = this.current;

    return {
      status: current === undefined ? "down" : "up",
      keyCount: current?.keys.size ?? 0,
      lastSuccessfulRefreshAt: current?.loadedAt ?? null,
      lastFailureReason: this.lastFailureReason
    };
  }

  public async getKey(kid: string): Promise<
    | {
        readonly ok: true;
        readonly key: JwksVerificationKey;
      }
    | {
        readonly ok: false;
        readonly reason: "jwt_key_not_found" | "jwks_unavailable";
      }
  > {
    const cachedKey = this.current?.keys.get(kid);
    if (cachedKey !== undefined) {
      return { ok: true, key: cachedKey };
    }

    const refreshFailure = await this.refresh();
    if (refreshFailure !== null) {
      return { ok: false, reason: "jwks_unavailable" };
    }

    const refreshedKey = this.current?.keys.get(kid);
    if (refreshedKey === undefined) {
      return { ok: false, reason: "jwt_key_not_found" };
    }

    return { ok: true, key: refreshedKey };
  }

  public async refresh(): Promise<TenantAuthFailureReason | null> {
    if (this.refreshPromise !== undefined) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async performRefresh(): Promise<TenantAuthFailureReason | null> {
    const response = await this.client.fetch();
    if (!response.ok) {
      this.lastFailureReason = response.reason;
      console.warn(`tenant auth JWKS refresh failed: ${response.reason}`);
      return response.reason;
    }

    const parsed = await parseJwks(response.body);
    if (!parsed.ok) {
      this.lastFailureReason = parsed.reason;
      console.warn(`tenant auth JWKS refresh failed: ${parsed.reason}`);
      return parsed.reason;
    }

    this.current = {
      keys: parsed.keys,
      loadedAt: new Date()
    };
    this.lastFailureReason = null;
    return null;
  }
}

type ParseJwksResult =
  | {
      readonly ok: true;
      readonly keys: JwksKeySet["keys"];
    }
  | {
      readonly ok: false;
      readonly reason: "jwks_invalid";
    };

async function parseJwks(body: unknown): Promise<ParseJwksResult> {
  if (!isRecord(body) || !Array.isArray(body.keys) || body.keys.length === 0) {
    return { ok: false, reason: "jwks_invalid" };
  }

  const jose = await loadJoseRuntime();
  const keys = new Map<string, Awaited<ReturnType<typeof jose.importJWK>>>();

  for (const item of body.keys) {
    if (!isRecord(item) || !isValidRsaSigningJwk(item)) {
      return { ok: false, reason: "jwks_invalid" };
    }

    const kid = item.kid;
    if (keys.has(kid)) {
      return { ok: false, reason: "jwks_invalid" };
    }

    try {
      const key = await jose.importJWK(item, "RS256");
      keys.set(kid, key);
    } catch {
      return { ok: false, reason: "jwks_invalid" };
    }
  }

  return { ok: true, keys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRsaSigningJwk(value: Record<string, unknown>): value is {
  readonly kty: "RSA";
  readonly use: "sig";
  readonly alg: "RS256";
  readonly kid: string;
  readonly n: string;
  readonly e: string;
} {
  return (
    value.kty === "RSA" &&
    value.use === "sig" &&
    value.alg === "RS256" &&
    typeof value.kid === "string" &&
    value.kid.trim() !== "" &&
    typeof value.n === "string" &&
    value.n.trim() !== "" &&
    typeof value.e === "string" &&
    value.e.trim() !== ""
  );
}
