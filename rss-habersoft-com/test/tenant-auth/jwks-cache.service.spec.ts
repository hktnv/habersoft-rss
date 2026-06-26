import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import type { JwksFetchResult, JwksFetcher } from "../../src/tenant-auth/jwks-http.client";
import type { ScheduledTask, TimerScheduler } from "../../src/tenant-auth/timer-scheduler";
import { generateTestKeyPair, jwks, runtimeConfig } from "./tenant-auth-test-helpers";

class SequenceFetcher implements JwksFetcher {
  public calls = 0;

  public constructor(private readonly responses: readonly JwksFetchResult[]) {}

  public fetch(): Promise<JwksFetchResult> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    return Promise.resolve(response ?? { ok: false, reason: "jwks_unavailable" });
  }
}

class RecordingScheduler implements TimerScheduler {
  public intervalMs: number | undefined;
  public callback: (() => void) | undefined;
  public cancelled = false;

  public scheduleRepeating(callback: () => void, intervalMs: number): ScheduledTask {
    this.callback = callback;
    this.intervalMs = intervalMs;

    return {
      cancel: () => {
        this.cancelled = true;
      }
    };
  }
}

describe("JwksCacheService", () => {
  it("loads JWKS on startup, schedules periodic refresh, and serves cached keys", async () => {
    const key = generateTestKeyPair("kid-a");
    const fetcher = new SequenceFetcher([{ ok: true, body: jwks([key]) }]);
    const scheduler = new RecordingScheduler();
    const cache = new JwksCacheService(runtimeConfig, fetcher, scheduler);

    await cache.onModuleInit();
    const result = await cache.getKey("kid-a");
    cache.onModuleDestroy();

    expect(result.ok).toBe(true);
    expect(fetcher.calls).toBe(1);
    expect(cache.readiness()).toMatchObject({
      status: "up",
      keyCount: 1,
      lastFailureReason: null
    });
    expect(scheduler.intervalMs).toBe(runtimeConfig.tenantAuth?.refreshIntervalMs);
    expect(scheduler.cancelled).toBe(true);
  });

  it("keeps the previous key set until a valid replacement is fetched", async () => {
    const oldKey = generateTestKeyPair("kid-old");
    const newKey = generateTestKeyPair("kid-new");
    const fetcher = new SequenceFetcher([
      { ok: true, body: jwks([oldKey]) },
      { ok: false, reason: "jwks_unavailable" },
      { ok: true, body: jwks([newKey]) }
    ]);
    const cache = new JwksCacheService(runtimeConfig, fetcher, new RecordingScheduler());

    await cache.onModuleInit();
    expect((await cache.getKey("kid-old")).ok).toBe(true);

    await cache.refresh();
    expect((await cache.getKey("kid-old")).ok).toBe(true);

    await cache.refresh();
    expect((await cache.getKey("kid-new")).ok).toBe(true);
    expect((await cache.getKey("kid-old")).ok).toBe(false);
  });

  it("deduplicates concurrent refreshes", async () => {
    let resolveFetch: ((result: JwksFetchResult) => void) | undefined;
    const fetcher: JwksFetcher & { readonly calls: () => number } = {
      calls: () => fetchMock.mock.calls.length,
      fetch: () =>
        new Promise<JwksFetchResult>((resolve) => {
          resolveFetch = resolve;
        })
    };
    const fetchMock = jest.spyOn(fetcher, "fetch");
    const cache = new JwksCacheService(runtimeConfig, fetcher, new RecordingScheduler());

    const first = cache.refresh();
    const second = cache.refresh();
    resolveFetch?.({ ok: false, reason: "jwks_unavailable" });

    await expect(Promise.all([first, second])).resolves.toEqual(["jwks_unavailable", "jwks_unavailable"]);
    expect(fetcher.calls()).toBe(1);
  });

  it("reports invalid JWKS without logging token material", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = new SequenceFetcher([{ ok: true, body: { keys: [] } }]);
    const cache = new JwksCacheService(runtimeConfig, fetcher, new RecordingScheduler());

    await cache.refresh();

    expect(cache.readiness()).toMatchObject({
      status: "down",
      lastFailureReason: "jwks_invalid"
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Bearer");
    warn.mockRestore();
  });
});
