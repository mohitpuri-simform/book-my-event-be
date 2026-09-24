import { Queue } from "bullmq";
import { redis } from "../lib/redis";
import type { SendOtpEmailPayload, SendSupportAlertEmailPayload } from "../services/mailer.service";

export const MAIL_QUEUE_NAME = "mail";

export const SEND_OTP_JOB = "send-otp";
export const SEND_SUPPORT_ALERT_JOB = "send-support-alert";

export const mailQueue = new Queue(MAIL_QUEUE_NAME, { connection: redis });

export async function enqueueOtpEmail(payload: SendOtpEmailPayload): Promise<void> {
  await mailQueue.add(SEND_OTP_JOB, payload, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  });
}

export async function enqueueSupportAlertEmail(
  payload: SendSupportAlertEmailPayload,
): Promise<void> {
  await mailQueue.add(SEND_SUPPORT_ALERT_JOB, payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  });
}
