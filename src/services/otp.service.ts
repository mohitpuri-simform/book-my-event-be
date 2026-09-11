import { createHash, randomInt } from "node:crypto";
import { env } from "../config/env";
import { redis } from "../lib/redis";
import { ApiError } from "../utils/ApiError";
import { MESSAGES } from "../constants/messages.constants";

const OTP_LENGTH = 6;

function otpKey(email: string): string {
  return `otp:${email}`;
}

function otpAttemptsKey(email: string): string {
  return `otp:attempts:${email}`;
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

export async function storeOtp(email: string, otp: string): Promise<void> {
  await redis
    .multi()
    .set(otpKey(email), hashOtp(otp), "EX", env.OTP_TTL_SECONDS)
    .del(otpAttemptsKey(email))
    .exec();
}

/**
 * Performs roughly the same number of Redis round-trips as storeOtp() plus
 * enqueueing the email would, without actually issuing an OTP. Called when
 * no account exists for the requested email, so response timing doesn't
 * become a side channel for checking which emails are registered.
 */
export async function simulateOtpIssuance(email: string): Promise<void> {
  await redis.exists(otpKey(email));
  await redis.exists(otpAttemptsKey(email));
}

export async function verifyAndConsumeOtp(email: string, otp: string): Promise<void> {
  const [storedHash, attempts] = await Promise.all([
    redis.get(otpKey(email)),
    redis.incr(otpAttemptsKey(email)),
  ]);

  if (attempts === 1) {
    await redis.expire(otpAttemptsKey(email), env.OTP_TTL_SECONDS);
  }

  if (!storedHash) {
    throw new ApiError(400, MESSAGES.otp.invalidOrExpiredOtp);
  }

  if (attempts > env.OTP_MAX_VERIFY_ATTEMPTS) {
    await redis.del(otpKey(email), otpAttemptsKey(email));
    throw new ApiError(429, MESSAGES.otp.tooManyFailedAttempts);
  }

  if (storedHash !== hashOtp(otp)) {
    throw new ApiError(400, MESSAGES.otp.invalidOrExpiredOtp);
  }

  await redis.del(otpKey(email), otpAttemptsKey(email));
}
