import {
  validateNoDetailQueryParameters,
  validateTenantEntryId
} from "../../src/tenant-entry-detail/tenant-entry-detail.validation";

describe("tenant entry detail validation", () => {
  it("accepts strict positive PostgreSQL bigint decimal entry ids", () => {
    expect(validateTenantEntryId("1")).toEqual({ ok: true, value: 1n });
    expect(validateTenantEntryId("9223372036854775807")).toEqual({
      ok: true,
      value: 9223372036854775807n
    });
  });

  it("rejects invalid entry ids", () => {
    expect(validateTenantEntryId("0").ok).toBe(false);
    expect(validateTenantEntryId("01").ok).toBe(false);
    expect(validateTenantEntryId("-1").ok).toBe(false);
    expect(validateTenantEntryId("9223372036854775808").ok).toBe(false);
    expect(validateTenantEntryId(["1"]).ok).toBe(false);
  });

  it("rejects every query parameter including tenant override attempts", () => {
    expect(validateNoDetailQueryParameters({})).toEqual({ ok: true, value: undefined });
    expect(validateNoDetailQueryParameters({ site_client_id: "site-b" }).ok).toBe(false);
    expect(validateNoDetailQueryParameters({ limit: "1" }).ok).toBe(false);
    expect(validateNoDetailQueryParameters([]).ok).toBe(false);
  });
});
