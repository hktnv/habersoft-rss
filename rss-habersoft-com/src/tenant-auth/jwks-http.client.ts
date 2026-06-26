import { Inject, Injectable } from "@nestjs/common";
import { RUNTIME_CONFIG } from "../configuration/runtime-config.module";
import { RuntimeConfig } from "../configuration/runtime-config";

export type JwksFetchResult =
  | {
      readonly ok: true;
      readonly body: unknown;
    }
  | {
      readonly ok: false;
      readonly reason: "jwks_unavailable" | "jwks_invalid";
    };

export interface JwksFetcher {
  fetch(): Promise<JwksFetchResult>;
}

@Injectable()
export class JwksHttpClient implements JwksFetcher {
  public constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  public async fetch(): Promise<JwksFetchResult> {
    const tenantAuth = this.config.tenantAuth;
    if (tenantAuth === undefined) {
      return { ok: false, reason: "jwks_unavailable" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), tenantAuth.httpTimeoutMs);

    let response: Response;

    try {
      response = await fetch(tenantAuth.jwksUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeout);
      return { ok: false, reason: "jwks_unavailable" };
    }

    try {
      if (!response.ok) {
        return { ok: false, reason: "jwks_unavailable" };
      }

      const body = await readBoundedBody(response, tenantAuth.maxResponseBytes);
      return { ok: true, body };
    } catch {
      return { ok: false, reason: "jwks_invalid" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new Error("JWKS response is too large");
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("JWKS response is too large");
  }

  return JSON.parse(text) as unknown;
}
