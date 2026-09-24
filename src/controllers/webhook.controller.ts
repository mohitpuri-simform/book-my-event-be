import type { Request, Response } from "express";
import type Stripe from "stripe";
import { env } from "../config/env";
import { MESSAGES } from "../constants/messages.constants";
import { logger } from "../lib/logger";
import { stripe } from "../lib/stripe";
import { handleStripeWebhookEvent } from "../services/payment.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Consumes the raw request body (mounted before the global JSON parser in
 * app.ts) so the Stripe signature can be verified before anything else
 * happens — an unverified body must never reach business logic.
 */
export const postStripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];

  if (typeof signature !== "string") {
    res.status(400).json({ success: false, message: MESSAGES.webhooks.invalidSignature });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    logger.warn({ err: error }, "stripe webhook signature verification failed");
    res.status(400).json({ success: false, message: MESSAGES.webhooks.invalidSignature });
    return;
  }

  await handleStripeWebhookEvent(event);

  res.status(200).json({ received: true });
});
