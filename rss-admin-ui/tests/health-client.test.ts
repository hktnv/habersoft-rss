import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHealthUrl,
  healthClientContract,
  observeBackendHealth,
  type FetchLike
} from "../src/status/healthClient";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("read-only health client", () => {
  it("uses exact same-origin live and ready status paths", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ status: "live" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ready",
          dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
        })
      );

    const observation = await observeBackendHealth({
      fetchImpl,
      now: () => new Date("2026-06-20T00:00:00.000Z")
    });

    expect(buildHealthUrl("live")).toBe("/status-api/health/live");
    expect(buildHealthUrl("ready")).toBe("/status-api/health/ready");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/status-api/health/live",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/status-api/health/ready",
      expect.objectContaining({ method: "GET" })
    );
    expect(observation.overall).toBe("healthy");
    expect(observation.observedAt).toBe("2026-06-20T00:00:00.000Z");
  });

  it("uses GET only with no credentials, cache reuse, auth header, cookie header, or Agent key", async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ status: "live" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ready",
          dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
        })
      );

    await observeBackendHealth({ fetchImpl });

    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(init?.credentials).toBe("omit");
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(JSON.stringify(init?.headers)).not.toMatch(/Authorization|Cookie|AGENT_KEY|X-Agent-Key/iu);
      expect(init).not.toHaveProperty("body");
    }
    expect(healthClientContract).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      authorizationHeader: false,
      agentKeyHeader: false,
      writes: false,
      endpoints: ["/status-api/health/live", "/status-api/health/ready"],
      upstreamMappings: {
        "/status-api/health/live": "/health/live",
        "/status-api/health/ready": "/health/ready"
      }
    });
  });

  it("validates live, ready, and documented dependency payloads", async () => {
    const observation = await observeBackendHealth({
      fetchImpl: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(jsonResponse({ status: "live" }))
        .mockResolvedValueOnce(
          jsonResponse({
            status: "ready",
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
          })
        )
    });

    expect(observation.live.ok).toBe(true);
    expect(observation.ready.ok).toBe(true);
    if (observation.ready.ok) {
      expect(observation.ready.payload.dependencies).toEqual({
        postgres: "up",
        redis: "up",
        tenantAuth: "up"
      });
    }
  });

  it("normalizes malformed JSON without leaking raw response body text", async () => {
    const observation = await observeBackendHealth({
      fetchImpl: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(new Response("{not json", { status: 200 }))
        .mockResolvedValueOnce(
          jsonResponse({
            status: "ready",
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
          })
        )
    });

    expect(observation.overall).toBe("unavailable");
    expect(observation.live.ok).toBe(false);
    if (!observation.live.ok) {
      expect(observation.live.error.code).toBe("invalid_json");
      expect(observation.live.error.message).not.toContain("{not json");
    }
  });

  it("rejects structurally invalid JSON", async () => {
    const observation = await observeBackendHealth({
      fetchImpl: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(jsonResponse({ status: "ok" }))
        .mockResolvedValueOnce(
          jsonResponse({
            status: "ready",
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
          })
        )
    });

    expect(observation.overall).toBe("unavailable");
    expect(observation.live.ok).toBe(false);
    if (!observation.live.ok) {
      expect(observation.live.error.code).toBe("invalid_payload");
    }
  });

  it("treats non-accepted liveness HTTP status as unavailable without raw body leakage", async () => {
    const observation = await observeBackendHealth({
      fetchImpl: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(new Response("raw backend body", { status: 500 }))
        .mockResolvedValueOnce(
          jsonResponse({
            status: "ready",
            dependencies: { postgres: "up", redis: "up", tenantAuth: "up" }
          })
        )
    });

    expect(observation.overall).toBe("unavailable");
    expect(observation.live.ok).toBe(false);
    if (!observation.live.ok) {
      expect(observation.live.error.code).toBe("http_status_unaccepted");
      expect(observation.live.error.message).not.toContain("raw backend body");
    }
  });

  it("accepts documented readiness failure responses as degraded observations", async () => {
    const observation = await observeBackendHealth({
      fetchImpl: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(jsonResponse({ status: "live" }))
        .mockResolvedValueOnce(
          jsonResponse(
            {
              status: "not_ready",
              dependencies: { postgres: "up", redis: "down", tenantAuth: "up" }
            },
            503
          )
        )
    });

    expect(observation.overall).toBe("degraded");
    expect(observation.ready.ok).toBe(true);
    if (observation.ready.ok) {
      expect(observation.ready.payload.dependencies.redis).toBe("down");
    }
  });

  it("bounds requests with timeout and reports safe abort errors", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<FetchLike>((_input, init) => rejectWhenAborted(init?.signal));

    const pending = observeBackendHealth({ fetchImpl, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const observation = await pending;

    expect(observation.overall).toBe("unavailable");
    expect(observation.live.ok).toBe(false);
    if (!observation.live.ok) {
      expect(observation.live.error.code).toBe("request_timeout");
    }
  });

  it("honors caller cancellation without exposing exception details", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<FetchLike>((_input, init) => rejectWhenAborted(init?.signal));

    const pending = observeBackendHealth({ fetchImpl, signal: controller.signal });
    controller.abort();
    const observation = await pending;

    expect(observation.live.ok).toBe(false);
    if (!observation.live.ok) {
      expect(observation.live.error.code).toBe("request_aborted");
      expect(observation.live.error.message).not.toMatch(/DOMException|stack|AbortError/u);
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function rejectWhenAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}
