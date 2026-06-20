import { deriveTenantRateLimitKey } from "../../src/tenant-rate-limit/tenant-rate-limit.key-derivation";

describe("deriveTenantRateLimitKey", () => {
  it("derives stable HMAC-backed keys without exposing the tenant identifier", () => {
    const key = deriveTenantRateLimitKey({
      tenantIdentifier: "site-client-a",
      redisPrefix: "tenant_rate_limit:test",
      keySecret: "test_only_tenant_rate_limit_key_secret_32"
    });

    expect(key).toBe(
      deriveTenantRateLimitKey({
        tenantIdentifier: "site-client-a",
        redisPrefix: "tenant_rate_limit:test",
        keySecret: "test_only_tenant_rate_limit_key_secret_32"
      })
    );
    expect(key).toMatch(/^tenant_rate_limit:test:tenant:[a-f0-9]{64}:window$/u);
    expect(key).not.toContain("site-client-a");
  });

  it("isolates tenants and secrets", () => {
    const common = {
      redisPrefix: "tenant_rate_limit:test",
      keySecret: "test_only_tenant_rate_limit_key_secret_32"
    };

    const first = deriveTenantRateLimitKey({ ...common, tenantIdentifier: "site-client-a" });
    const second = deriveTenantRateLimitKey({ ...common, tenantIdentifier: "site-client-b" });
    const third = deriveTenantRateLimitKey({
      ...common,
      tenantIdentifier: "site-client-a",
      keySecret: "another_test_only_rate_limit_secret_32"
    });

    expect(first).not.toBe(second);
    expect(first).not.toBe(third);
  });
});
