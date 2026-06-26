import { AuthorizationHeaderParser } from "../../src/tenant-auth/authorization-header.parser";

describe("AuthorizationHeaderParser", () => {
  const parser = new AuthorizationHeaderParser();

  it("extracts a bearer token", () => {
    expect(parser.parse("Bearer abc.def.ghi")).toEqual({
      ok: true,
      token: "abc.def.ghi"
    });
  });

  it("rejects missing, malformed, and repeated authorization headers", () => {
    expect(parser.parse(undefined)).toEqual({
      ok: false,
      reason: "authorization_header_missing"
    });
    expect(parser.parse("Basic value")).toEqual({
      ok: false,
      reason: "authorization_header_malformed"
    });
    expect(parser.parse(["Bearer one", "Bearer two"])).toEqual({
      ok: false,
      reason: "authorization_header_multiple"
    });
  });
});
