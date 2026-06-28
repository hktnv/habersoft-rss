import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
export const ADMIN_PASSWORD_HASH_ITERATIONS = 120000;
export const ADMIN_PASSWORD_HASH_KEY_BYTES = 32;
export const ADMIN_PASSWORD_HASH_SALT_BYTES = 16;

export function hashAdminPassword(password: string, salt: Buffer = randomBytes(ADMIN_PASSWORD_HASH_SALT_BYTES)): string {
  const digest = pbkdf2Sync(password, salt, ADMIN_PASSWORD_HASH_ITERATIONS, ADMIN_PASSWORD_HASH_KEY_BYTES, "sha256");
  return [
    ADMIN_PASSWORD_HASH_ALGORITHM,
    ADMIN_PASSWORD_HASH_ITERATIONS.toString(),
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join("$");
}

export function verifyAdminPasswordHash(password: string, encodedHash: string): boolean {
  const parsed = parseAdminPasswordHash(encodedHash);
  if (parsed === undefined) {
    return false;
  }

  const candidate = pbkdf2Sync(password, parsed.salt, parsed.iterations, parsed.digest.length, "sha256");
  return candidate.length === parsed.digest.length && timingSafeEqual(candidate, parsed.digest);
}

function parseAdminPasswordHash(encodedHash: string):
  | {
      readonly iterations: number;
      readonly salt: Buffer;
      readonly digest: Buffer;
    }
  | undefined {
  const [algorithm, iterationsText, saltText, digestText, ...extra] = encodedHash.split("$");
  if (
    algorithm !== ADMIN_PASSWORD_HASH_ALGORITHM ||
    iterationsText === undefined ||
    saltText === undefined ||
    digestText === undefined ||
    extra.length > 0
  ) {
    return undefined;
  }

  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100000) {
    return undefined;
  }

  const salt = Buffer.from(saltText, "base64url");
  const digest = Buffer.from(digestText, "base64url");
  if (salt.length < ADMIN_PASSWORD_HASH_SALT_BYTES || digest.length < ADMIN_PASSWORD_HASH_KEY_BYTES) {
    return undefined;
  }

  return {
    iterations,
    salt,
    digest
  };
}

