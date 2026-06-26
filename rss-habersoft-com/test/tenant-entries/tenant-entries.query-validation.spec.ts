import {
  validateTenantEntriesQuery,
  defaultEntryListLimit,
  defaultEntryListOffset
} from "../../src/tenant-entries/tenant-entries.query-validation";

describe("validateTenantEntriesQuery", () => {
  it("uses bounded defaults", () => {
    expect(validateTenantEntriesQuery({})).toEqual({
      ok: true,
      value: {
        offset: defaultEntryListOffset,
        limit: defaultEntryListLimit
      }
    });
  });

  it("accepts explicit offset and limit bounds", () => {
    expect(validateTenantEntriesQuery({ offset: "1000", limit: "100" })).toEqual({
      ok: true,
      value: {
        offset: 1000,
        limit: 100
      }
    });
  });

  it("rejects unknown, tenant override, array, negative, and out-of-range values", () => {
    expect(validateTenantEntriesQuery({ feed_id: "1" })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ site_client_id: "site-b" })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ offset: ["0"] })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ offset: "-1" })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ offset: "1001" })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ limit: "0" })).toEqual({ ok: false });
    expect(validateTenantEntriesQuery({ limit: "101" })).toEqual({ ok: false });
  });
});
