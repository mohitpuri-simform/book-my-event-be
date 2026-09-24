import { Worker, type Job } from "bullmq";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import { HOLD_EXPIRY_QUEUE_NAME, RELEASE_HOLD_JOB } from "../queues/holdExpiry.queue";
import { processHoldExpiryJob } from "../services/hold.service";

export const holdExpiryWorker = new Worker(
  HOLD_EXPIRY_QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case RELEASE_HOLD_JOB:
        await processHoldExpiryJob((job.data as { holdId: string }).holdId);
        break;
      default:
        logger.warn({ jobName: job.name }, "unknown hold-expiry job");
    }
  },
  { connection: redis },
);

holdExpiryWorker.on("failed", (job, error) => {
  logger.error({ err: error, jobId: job?.id, jobName: job?.name }, "hold-expiry job failed");
});
