import { Queue } from "bullmq";
import { env } from "../config/env";
import { redis } from "../lib/redis";

export const HOLD_EXPIRY_QUEUE_NAME = "hold-expiry";

export const RELEASE_HOLD_JOB = "release-hold";

export interface ReleaseHoldJobPayload {
  holdId: string;
  seatId: string;
}

export const holdExpiryQueue = new Queue(HOLD_EXPIRY_QUEUE_NAME, { connection: redis });

/**
 * Schedules the fallback release for a hold. The job handler re-checks the
 * hold's actual `expiresAt`/status before releasing anything — this delay
 * is a backstop, not the source of truth (a delayed/dropped job must never
 * be able to leave a seat stuck as held forever, nor incorrectly release a
 * hold that was already re-confirmed).
 */
export async function scheduleHoldExpiry(payload: ReleaseHoldJobPayload): Promise<void> {
  await holdExpiryQueue.add(RELEASE_HOLD_JOB, payload, {
    jobId: payload.holdId,
    delay: env.HOLD_TTL_SECONDS * 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  });
}

/** Best-effort cancel for a hold that was released/confirmed before its TTL elapsed. */
export async function cancelHoldExpiry(holdId: string): Promise<void> {
  const job = await holdExpiryQueue.getJob(holdId);
  if (job) {
    await job.remove().catch(() => undefined);
  }
}
