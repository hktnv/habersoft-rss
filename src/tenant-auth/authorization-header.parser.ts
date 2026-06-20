import { Injectable } from "@nestjs/common";
import { AuthorizationParseResult } from "./tenant-auth.types";

@Injectable()
export class AuthorizationHeaderParser {
  public parse(value: string | string[] | undefined): AuthorizationParseResult {
    if (value === undefined) {
      return { ok: false, reason: "authorization_header_missing" };
    }

    if (Array.isArray(value)) {
      return { ok: false, reason: "authorization_header_multiple" };
    }

    const text = value.trim();
    const parts = text.split(/\s+/u);

    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return { ok: false, reason: "authorization_header_malformed" };
    }

    const token = parts[1];
    if (token === undefined || token.trim() === "") {
      return { ok: false, reason: "authorization_header_malformed" };
    }

    return { ok: true, token };
  }
}
