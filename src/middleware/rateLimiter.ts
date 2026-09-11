import type { NextFunction, Request, Response } from "express";
import { incrWithExpire, redis } from "../lib/redis";
import { ApiError } from "../utils/ApiError";
import { MESSAGES } from "../constants/messages.constants";

type KeyResolver = (req: Request) => string | null;

interface RateLimiterOptions {
  keyPrefix: string;
  max: number;
  windowSeconds: number;
  /** Defaults to the request's IP address. */
  keyResolver?: KeyResolver;
}

export function ipKeyResolver(req: Request): string {
  return req.ip ?? "unknown";
}

/**
 * Keys by the `email` field in the request body, normalized so that
 * `User@Example.com` and `user@example.com` share the same bucket.
 * Returns null (skipping the limiter) when no email is present yet —
 * schema validation, not this middleware, is responsible for rejecting that.
 */
export function emailKeyResolver(req: Request): string | null {
  const email = String((req.body as Record<string, unknown> | undefined)?.email ?? "")
    .trim()
    .toLowerCase();
  return email || null;
}

export function rateLimiter({
  keyPrefix,
  max,
  windowSeconds,
  keyResolver = ipKeyResolver,
}: RateLimiterOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = keyResolver(req);
    if (!identifier) {
      next();
      return;
    }

    const key = `ratelimit:${keyPrefix}:${identifier}`;
    const count = await incrWithExpire(key, windowSeconds);

    if (count > max) {
      const ttl = await redis.ttl(key);
      const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
      res.setHeader("Retry-After", String(retryAfterSeconds));
      next(new ApiError(429, MESSAGES.rateLimit.tooManyRequests(retryAfterSeconds)));
      return;
    }

    next();
  };
}
