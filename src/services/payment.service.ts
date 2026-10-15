import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { Prisma } from "../../generated/prisma/client";
import { MESSAGES } from "../constants/messages.constants";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { deleteIfHoldMatches, redis } from "../lib/redis";
import { parseSeatHoldValue, seatHoldKey } from "../lib/seatHold";
import { stripe } from "../lib/stripe";
import { cancelHoldExpiry } from "../queues/holdExpiry.queue";
import { ApiError } from "../utils/ApiError";
import { hasEventEnded } from "../utils/eventTime";
import { generateTicketRef } from "./booking.service";
import { releaseHoldRecord, validateHoldsForCheckout, type ValidatedHold } from "./hold.service";
import { syncAccountStatus } from "./stripeConnect.service";
import { creditWalletForPaymentIntent, handleChargeUpdated } from "./wallet.service";

export interface CheckoutResult {
  paymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  holds: ValidatedHold[];
}

/**
 * Starts (or resumes) a Stripe payment for a cart of holds. Every hold is
 * re-validated against Redis first (§2.3) — checkout never proceeds against
 * a hold that has already expired or been taken by someone else.
 */
export async function createCheckout(userId: string, holdIds: string[]): Promise<CheckoutResult> {
  if (holdIds.length === 0) {
    throw new ApiError(400, MESSAGES.checkout.holdsRequired);
  }

  const result = await validateHoldsForCheckout(userId, holdIds);
  if (!result.valid) {
    throw new ApiError(409, MESSAGES.holds.someHoldsExpired, {
      invalidHoldIds: result.invalidHoldIds,
    });
  }

  const { holds } = result;

  // A hold can outlive its event by a few minutes — never take money for an
  // event that is already over.
  const events = await prisma.event.findMany({
    where: { id: { in: [...new Set(holds.map((h) => h.eventId))] } },
    select: { endDate: true },
  });
  if (events.some((event) => hasEventEnded(event))) {
    throw new ApiError(409, MESSAGES.events.hasEnded);
  }

  const amountCents = holds.reduce((sum, h) => sum + h.priceCents, 0);

  // Same user + same holds + same amount => the same PaymentIntent, so a
  // double-click or retry can't create a second one the user could pay twice.
  // (Hold ids are unique per hold, so a new selection always gets a new key.)
  const checkoutKey = createHash("sha256")
    .update(JSON.stringify([userId, holds.map((h) => h.holdId).sort(), amountCents]))
    .digest("hex");

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        payment_method_types: ["card"],
        metadata: { userId, holdIds: JSON.stringify(holds.map((h) => h.holdId)) },
      },
      { idempotencyKey: `checkout-${checkoutKey}` },
    );
  } catch (error) {
    logger.error({ err: error, userId, holdIds }, "failed to create stripe payment intent");
    throw new ApiError(502, MESSAGES.payments.intentCreateFailed);
  }

  if (!intent.client_secret) {
    throw new ApiError(502, MESSAGES.payments.intentCreateFailed);
  }

  await prisma.$transaction(
    holds.map((h) =>
      prisma.paymentAttempt.upsert({
        where: { holdId: h.holdId },
        create: {
          holdId: h.holdId,
          userId,
          stripePaymentIntentId: intent.id,
          amountCents: h.priceCents,
          status: "PENDING",
        },
        update: {
          stripePaymentIntentId: intent.id,
          amountCents: h.priceCents,
          status: "PENDING",
        },
      }),
    ),
  );

  logger.info({ userId, holdIds, paymentIntentId: intent.id, amountCents }, "checkout started");

  return { paymentIntentId: intent.id, clientSecret: intent.client_secret, amountCents, holds };
}

export interface CheckoutStatusAttempt {
  holdId: string;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "VOIDED" | "EXPIRED_BEFORE_CONFIRMATION";
}

/**
 * Reports what actually happened to a checkout's payment attempts, scoped
 * to the requesting user. Stripe.js confirming a charge client-side is not
 * the same as the backend having finalized a booking for it (see
 * finalizeAttempt) — a client polling only `/me/bookings` has no way to
 * distinguish "still waiting on the webhook" from "the webhook already
 * voided/refunded this because the hold expired first". This closes that
 * gap so the frontend can show an explicit outcome instead of polling
 * forever or going silently back to an empty cart.
 */
export async function getCheckoutStatus(
  userId: string,
  paymentIntentId: string,
): Promise<CheckoutStatusAttempt[] | null> {
  const attempts = await prisma.paymentAttempt.findMany({
    where: { stripePaymentIntentId: paymentIntentId, userId },
    select: { holdId: true, status: true },
  });

  if (attempts.length === 0) {
    return null;
  }

  return attempts;
}

/**
 * Refunds one hold's share of a payment. The idempotency key is per
 * (reason, hold, payment), so a retried call or a redelivered webhook can never
 * refund the same money twice. A failure is logged, not thrown — the webhook
 * must still be acknowledged.
 */
async function refundHoldPayment(
  reason: "expired-before-confirmation" | "duplicate-payment",
  holdId: string,
  paymentIntentId: string,
  amountCents: number,
): Promise<void> {
  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountCents },
      { idempotencyKey: `refund-${reason}-${holdId}-${paymentIntentId}` },
    );
    logger.info({ holdId, paymentIntentId, amountCents, reason }, "payment refunded");
  } catch (error) {
    logger.error(
      { err: error, holdId, paymentIntentId, amountCents, reason },
      "failed to issue refund",
    );
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseHoldIdsFromMetadata(metadata: Stripe.Metadata): string[] {
  const raw = metadata.holdIds;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Finalizes (or rejects) a single hold's booking for a payment_intent.succeeded
 * event. See §3.2: PENDING attempts are the only ones acted on; CONFIRMED is
 * a replay no-op; FAILED/VOIDED/EXPIRED_BEFORE_CONFIRMATION is a logged
 * anomaly. A PENDING attempt whose seat's Redis hold no longer matches is
 * rejected and (partially, per-seat) refunded rather than finalized.
 */
async function finalizeAttempt(holdId: string, paymentIntentId: string): Promise<void> {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { holdId },
    include: {
      hold: { include: { seat: { include: { section: { select: { eventId: true } } } } } },
    },
  });

  if (!attempt) {
    logger.error({ holdId, paymentIntentId }, "payment confirmation for unknown payment attempt");
    return;
  }

  if (attempt.status === "CONFIRMED") {
    if (attempt.stripePaymentIntentId === paymentIntentId) {
      logger.info({ holdId, paymentIntentId }, "duplicate webhook confirmation, already confirmed");
      return;
    }

    // The hold was already paid for by a different PaymentIntent, so this is a
    // second charge for the same seat: refund it rather than keep the money.
    logger.error(
      {
        holdId,
        paymentIntentId,
        confirmedPaymentIntentId: attempt.stripePaymentIntentId,
        userId: attempt.userId,
      },
      "second payment for an already-confirmed hold — refunding the extra charge",
    );
    await refundHoldPayment("duplicate-payment", holdId, paymentIntentId, attempt.amountCents);
    return;
  }

  if (attempt.status !== "PENDING") {
    logger.warn(
      { holdId, paymentIntentId, status: attempt.status },
      "late confirmation for a payment attempt that is no longer pending",
    );
    return;
  }

  const seatId = attempt.hold.seatId;
  const value = parseSeatHoldValue(await redis.get(seatHoldKey(seatId)));

  if (!value || value.holdId !== holdId) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "EXPIRED_BEFORE_CONFIRMATION" },
    });

    logger.error(
      {
        holdId,
        seatId,
        paymentIntentId,
        userId: attempt.userId,
        amountCents: attempt.amountCents,
      },
      "payment confirmed after hold expired/re-held — refunding instead of booking",
    );

    await refundHoldPayment(
      "expired-before-confirmation",
      holdId,
      paymentIntentId,
      attempt.amountCents,
    );
    return;
  }

  const ticketRef = generateTicketRef();

  await prisma.$transaction([
    prisma.booking.create({
      data: {
        holdId,
        seatId,
        userId: attempt.userId,
        eventId: attempt.hold.seat.section.eventId,
        priceCents: attempt.amountCents,
        ticketRef,
      },
    }),
    prisma.hold.update({ where: { id: holdId }, data: { status: "CONFIRMED" } }),
    prisma.seat.update({ where: { id: seatId }, data: { status: "BOOKED" } }),
    // Record the intent that actually paid, so a later payment from any other
    // intent for this hold is recognisable as an extra charge.
    prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "CONFIRMED", stripePaymentIntentId: paymentIntentId },
    }),
  ]);

  await deleteIfHoldMatches(seatHoldKey(seatId), holdId);
  await cancelHoldExpiry(holdId);

  logger.info(
    { holdId, seatId, userId: attempt.userId, paymentIntentId, ticketRef },
    "booking finalized",
  );
}

async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const holdIds = parseHoldIdsFromMetadata(intent.metadata);
  for (const holdId of holdIds) {
    await finalizeAttempt(holdId, intent.id);
  }

  await creditWalletForPaymentIntent(intent.id);
}

async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const holdIds = parseHoldIdsFromMetadata(intent.metadata);

  for (const holdId of holdIds) {
    const attempt = await prisma.paymentAttempt.findUnique({ where: { holdId } });
    if (!attempt || attempt.status !== "PENDING") continue;

    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });

    const hold = await prisma.hold.findUnique({ where: { id: holdId } });
    if (hold && hold.status === "ACTIVE") {
      await releaseHoldRecord(hold, "RELEASED");
      await cancelHoldExpiry(holdId);
    }

    logger.info({ holdId, paymentIntentId: intent.id }, "payment failed — hold released");
  }
}

/**
 * Entry point for the Stripe webhook route. `event.id` is the idempotency
 * key: a unique-constraint conflict on insert into `ProcessedWebhookEvent`
 * means this exact event was already handled, so it's a guaranteed no-op —
 * this is what makes replayed webhooks safe (rule #4).
 */
export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  try {
    await prisma.processedWebhookEvent.create({
      data: { stripeEventId: event.id, eventType: event.type },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      logger.info({ stripeEventId: event.id, eventType: event.type }, "duplicate webhook ignored");
      return;
    }
    throw error;
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(event.data.object);
      break;
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      await handlePaymentIntentFailed(event.data.object);
      break;
    case "charge.updated":
      await handleChargeUpdated(event.data.object);
      break;
    case "account.updated":
      await syncAccountStatus(event.data.object);
      break;
    default:
      logger.info({ eventType: event.type }, "unhandled stripe event type");
  }
}
