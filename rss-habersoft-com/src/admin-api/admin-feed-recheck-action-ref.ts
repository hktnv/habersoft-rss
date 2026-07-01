import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const actionRefVersion = "feed_recheck_v1";
const actionRefKind = "admin_feed_recheck";
const actionRefPattern = /^feed_recheck_v1\.[A-Za-z0-9_-]{48,512}$/u;
const postgresBigIntMax = 9223372036854775807n;

type FeedRecheckActionRefPayload = {
  readonly v: 1;
  readonly kind: typeof actionRefKind;
  readonly feedId: string;
};

export function createFeedRecheckActionRef(feedId: bigint, sessionSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", actionRefKey(sessionSecret), iv);
  const plaintext = Buffer.from(
    JSON.stringify({
      v: 1,
      kind: actionRefKind,
      feedId: feedId.toString(10)
    } satisfies FeedRecheckActionRefPayload),
    "utf8"
  );
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${actionRefVersion}.${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function parseFeedRecheckActionRef(actionRef: string, sessionSecret: string): bigint | undefined {
  if (!actionRefPattern.test(actionRef)) return undefined;
  const encoded = actionRef.slice(`${actionRefVersion}.`.length);
  let packed: Buffer;
  try {
    packed = Buffer.from(encoded, "base64url");
  } catch {
    return undefined;
  }

  if (packed.length <= 28) return undefined;
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);

  try {
    const decipher = createDecipheriv("aes-256-gcm", actionRefKey(sessionSecret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as FeedRecheckActionRefPayload;
    if (parsed.v !== 1 || parsed.kind !== actionRefKind || !/^[1-9][0-9]*$/u.test(parsed.feedId)) {
      return undefined;
    }

    const feedId = BigInt(parsed.feedId);
    return feedId <= postgresBigIntMax ? feedId : undefined;
  } catch {
    return undefined;
  }
}

export function isFeedRecheckActionRef(value: string): boolean {
  return actionRefPattern.test(value);
}

function actionRefKey(sessionSecret: string): Buffer {
  return createHash("sha256").update("ms026a:feed-recheck-action-ref", "utf8").update(sessionSecret, "utf8").digest();
}
