import { JwksCacheService } from "../../src/tenant-auth/jwks-cache.service";
import type { JwksFetchResult, JwksFetcher } from "../../src/tenant-auth/jwks-http.client";
import { TenantJwtVerifier } from "../../src/tenant-auth/tenant-jwt.verifier";
import type { ScheduledTask, TimerScheduler } from "../../src/tenant-auth/timer-scheduler";
import { generateTestKeyPair, jwks, runtimeConfig, signTenantToken } from "./tenant-auth-test-helpers";

class SequenceFetcher implements JwksFetcher {
  public calls = 0;

  public constructor(private readonly responses: readonly JwksFetchResult[]) {}

  public fetch(): Promise<JwksFetchResult> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    return Promise.resolve(response ?? { ok: false, reason: "jwks_unavailable" });
  }
}

class NoopScheduler implements TimerScheduler {
  public scheduleRepeating(): ScheduledTask {
    return {
      cancel: () => undefined
    };
  }
}

async function verifierWith(fetcher: JwksFetcher): Promise<TenantJwtVerifier> {
  const cache = new JwksCacheService(runtimeConfig, fetcher, new NoopScheduler());
  await cache.onModuleInit();
  return new TenantJwtVerifier(runtimeConfig, cache);
}

describe("TenantJwtVerifier", () => {
  it("verifies a valid RS256 tenant token and returns an immutable principal", async () => {
    const key = generateTestKeyPair("kid-a");
    const verifier = await verifierWith(new SequenceFetcher([{ ok: true, body: jwks([key]) }]));
    const token = signTenantToken({ key });

    const result = await verifier.verify(token);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.siteClientId).toBe("site-a");
      expect(result.principal.subject).toBe("site-a");
      expect(result.principal.scopes.has("services:access")).toBe(true);
      expect(Object.isFrozen(result.principal)).toBe(true);
    }
  });

  it("refreshes once on kid miss and accepts a newly published key", async () => {
    const oldKey = generateTestKeyPair("kid-old");
    const newKey = generateTestKeyPair("kid-new");
    const fetcher = new SequenceFetcher([
      { ok: true, body: jwks([oldKey]) },
      { ok: true, body: jwks([oldKey, newKey]) }
    ]);
    const verifier = await verifierWith(fetcher);
    const token = signTenantToken({ key: newKey });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: true
    });
    expect(fetcher.calls).toBe(2);
  });

  it("returns 403 semantics for a valid token without the required scope", async () => {
    const key = generateTestKeyPair("kid-a");
    const verifier = await verifierWith(new SequenceFetcher([{ ok: true, body: jwks([key]) }]));
    const token = signTenantToken({ key, scope: "other:scope" });

    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      outcome: "forbidden",
      reason: "insufficient_scope"
    });
  });

  it("rejects tokens with a client_id that does not match sub", async () => {
    const key = generateTestKeyPair("kid-a");
    const verifier = await verifierWith(new SequenceFetcher([{ ok: true, body: jwks([key]) }]));
    const token = signTenantToken({ key, subject: "site-a", clientId: "site-b" });

    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      outcome: "unauthenticated",
      reason: "jwt_client_id_invalid"
    });
  });

  it("returns 503 semantics when no JWKS can be loaded", async () => {
    const key = generateTestKeyPair("kid-a");
    const verifier = await verifierWith(new SequenceFetcher([{ ok: false, reason: "jwks_unavailable" }]));
    const token = signTenantToken({ key });

    await expect(verifier.verify(token)).resolves.toEqual({
      ok: false,
      outcome: "unavailable",
      reason: "jwks_unavailable"
    });
  });

  it("rejects tokens signed for a different audience", async () => {
    const key = generateTestKeyPair("kid-a");
    const verifier = await verifierWith(new SequenceFetcher([{ ok: true, body: jwks([key]) }]));
    const token = signTenantToken({ key, audience: ["another-service"] });

    await expect(verifier.verify(token)).resolves.toMatchObject({
      ok: false,
      outcome: "unauthenticated"
    });
  });
});
