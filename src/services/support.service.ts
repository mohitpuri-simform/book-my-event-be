import { logger } from "../lib/logger";
import { sendSupportAlertEmailNow } from "./mailer.service";
import type { CreateSupportTicketInput } from "../validation/support.schema";

/**
 * Sends the alert synchronously via nodemailer rather than through the
 * BullMQ mail queue. This route exists specifically for the "Redis is
 * down" case (§4.1) — with a single shared Redis instance, going through
 * BullMQ here would fail for the same reason hold creation just failed.
 */
export async function createSupportTicket(
  userId: string | null,
  input: CreateSupportTicketInput,
): Promise<void> {
  logger.error({ userId, subject: input.subject, context: input.context }, "support ticket raised");

  try {
    await sendSupportAlertEmailNow({
      subject: input.subject,
      message: input.message,
      context: { userId, ...input.context },
    });
  } catch (error) {
    logger.error({ err: error, userId }, "failed to send support alert email");
  }
}
