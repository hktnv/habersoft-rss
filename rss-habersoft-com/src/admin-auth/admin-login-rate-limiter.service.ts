import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ADMIN_AUTH_FAILURE_MAX_ATTEMPTS, ADMIN_AUTH_FAILURE_WINDOW_SECONDS } from "./admin-auth.constants";

type FailureBucket = {
  readonly expiresAt: number;
  readonly count: number;
};

@Injectable()
export class AdminLoginRateLimiter {
  private readonly failures = new Map<string, FailureBucket>();

  public assertAllowed(key: string, now: Date = new Date()): void {
    const bucket = this.currentBucket(key, now);
    if (bucket !== undefined && bucket.count >= ADMIN_AUTH_FAILURE_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          error_code: "ADMIN_AUTH_RATE_LIMITED",
          authenticated: false,
          reason: "rate_limited"
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  public recordFailure(key: string, now: Date = new Date()): void {
    const timestamp = now.getTime();
    const bucket = this.currentBucket(key, now);
    const next: FailureBucket =
      bucket === undefined
        ? {
            expiresAt: timestamp + ADMIN_AUTH_FAILURE_WINDOW_SECONDS * 1000,
            count: 1
          }
        : {
            expiresAt: bucket.expiresAt,
            count: bucket.count + 1
          };
    this.failures.set(key, next);
  }

  public recordSuccess(key: string): void {
    this.failures.delete(key);
  }

  private currentBucket(key: string, now: Date): FailureBucket | undefined {
    const bucket = this.failures.get(key);
    if (bucket === undefined) return undefined;
    if (bucket.expiresAt <= now.getTime()) {
      this.failures.delete(key);
      return undefined;
    }

    return bucket;
  }
}
