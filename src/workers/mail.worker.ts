import { Worker, type Job } from "bullmq";
import { redis } from "../lib/redis";
import { MAIL_QUEUE_NAME, SEND_OTP_JOB, SEND_SUPPORT_ALERT_JOB } from "../queues/mail.queue";
import {
  sendOtpEmailNow,
  sendSupportAlertEmailNow,
  type SendOtpEmailPayload,
  type SendSupportAlertEmailPayload,
} from "../services/mailer.service";

export const mailWorker = new Worker(
  MAIL_QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case SEND_OTP_JOB:
        await sendOtpEmailNow(job.data as SendOtpEmailPayload);
        break;
      case SEND_SUPPORT_ALERT_JOB:
        await sendSupportAlertEmailNow(job.data as SendSupportAlertEmailPayload);
        break;
      default:
        console.warn(`Unknown mail job: ${job.name}`);
    }
  },
  { connection: redis },
);

mailWorker.on("failed", (job, error) => {
  console.error(`Mail job ${job?.id} (${job?.name}) failed:`, error);
});
