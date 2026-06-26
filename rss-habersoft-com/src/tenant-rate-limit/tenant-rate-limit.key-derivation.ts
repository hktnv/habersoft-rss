import { createHmac } from "node:crypto";

export function deriveTenantRateLimitKey(input: {
  readonly tenantIdentifier: string;
  readonly redisPrefix: string;
  readonly keySecret: string;
}): string {
  const digest = createHmac("sha256", input.keySecret).update(input.tenantIdentifier, "utf8").digest("hex");
  return `${input.redisPrefix}:tenant:${digest}:window`;
}
