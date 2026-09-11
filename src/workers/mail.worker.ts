import { Worker, type Job } from "bullmq";
import { redis } from "../lib/redis";
import { MAIL_QUEUE_NAME, SEND_OTP_JOB } from "../queues/mail.queue";
import { sendOtpEmailNow, type SendOtpEmailPayload } from "../services/mailer.service";

export const mailWorker = new Worker(
  MAIL_QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case SEND_OTP_JOB:
        await sendOtpEmailNow(job.data as SendOtpEmailPayload);
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
