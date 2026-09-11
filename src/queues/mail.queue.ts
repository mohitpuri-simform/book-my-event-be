import { Queue } from "bullmq";
import { redis } from "../lib/redis";
import type { SendOtpEmailPayload } from "../services/mailer.service";

export const MAIL_QUEUE_NAME = "mail";

export const SEND_OTP_JOB = "send-otp";

export const mailQueue = new Queue(MAIL_QUEUE_NAME, { connection: redis });

export async function enqueueOtpEmail(payload: SendOtpEmailPayload): Promise<void> {
  await mailQueue.add(SEND_OTP_JOB, payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  });
}
