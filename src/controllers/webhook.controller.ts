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

  // STRIPE_WEBHOOK_SECRET may hold several comma-separated secrets: the account
  // destination and the Connect ("connected accounts") destination each have their own.
  const secrets = env.STRIPE_WEBHOOK_SECRET.split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

  let event: Stripe.Event | undefined;
  let lastError: unknown;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!event) {
    logger.warn({ err: lastError }, "stripe webhook signature verification failed");
    res.status(400).json({ success: false, message: MESSAGES.webhooks.invalidSignature });
    return;
  }

  await handleStripeWebhookEvent(event);

  res.status(200).json({ received: true });
});
