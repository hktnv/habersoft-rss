import { TenantRateLimitService } from "../../src/tenant-rate-limit/tenant-rate-limit.service";
import type { TenantRateLimitStore } from "../../src/tenant-rate-limit/tenant-rate-limit.types";
import { runtimeConfig, tenantRateLimitConfig } from "../tenant-auth/tenant-auth-test-helpers";

function store(overrides: Partial<TenantRateLimitStore>): TenantRateLimitStore {
  return {
    consume: jest.fn(),
    retryAfterSeconds: jest.fn(),
    supportsAtomicWindowCounter: jest.fn(),
    ...overrides
  };
}

describe("TenantRateLimitService", () => {
  it("fails closed when Redis does not support INCREX", async () => {
    const subject = new TenantRateLimitService(runtimeConfig, store({ supportsAtomicWindowCounter: () => Promise.resolve(false) }));

    await subject.onModuleInit();

    await expect(subject.consume("site-client-a")).resolves.toEqual({ outcome: "unavailable" });
  });

  it("allows requests within quota", async () => {
    const backingStore = store({
      supportsAtomicWindowCounter: () => Promise.resolve(true),
      consume: () => Promise.resolve({ ok: true, count: tenantRateLimitConfig.maxRequests })
    });
    const subject = new TenantRateLimitService(runtimeConfig, backingStore);

    await subject.onModuleInit();

    await expect(subject.consume("site-client-a")).resolves.toEqual({ outcome: "allowed" });
  });

  it("returns a positive Retry-After when quota is exceeded", async () => {
    const backingStore = store({
      supportsAtomicWindowCounter: () => Promise.resolve(true),
      consume: () => Promise.resolve({ ok: true, count: tenantRateLimitConfig.maxRequests + 1 }),
      retryAfterSeconds: () => Promise.resolve({ ok: true, retryAfterSeconds: 3 })
    });
    const subject = new TenantRateLimitService(runtimeConfig, backingStore);

    await subject.onModuleInit();

    await expect(subject.consume("site-client-a")).resolves.toEqual({
      outcome: "limited",
      retryAfterSeconds: 3
    });
  });

  it("fails closed when Redis replies cannot be interpreted", async () => {
    const backingStore = store({
      supportsAtomicWindowCounter: () => Promise.resolve(true),
      consume: () => Promise.resolve({ ok: false })
    });
    const subject = new TenantRateLimitService(runtimeConfig, backingStore);

    await subject.onModuleInit();

    await expect(subject.consume("site-client-a")).resolves.toEqual({ outcome: "unavailable" });
  });
});
