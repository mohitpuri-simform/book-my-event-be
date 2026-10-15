import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { seatHoldKey } from "../src/lib/seatHold";
import { disconnectAll, resetState } from "./helpers/db";
import { createEventWithSeat, createTestUser } from "./helpers/factories";

vi.mock("../src/lib/stripe", () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_test" }) },
  },
}));

// Imported after the mock so payment.service picks up the mocked client.
const { stripe } = await import("../src/lib/stripe");
const { handleStripeWebhookEvent } = await import("../src/services/payment.service");
const { holdSeat } = await import("../src/services/hold.service");

function makeStripeEvent(
  id: string,
  type: Stripe.Event.Type,
  paymentIntent: Partial<Stripe.PaymentIntent>,
): Stripe.Event {
  return { id, type, data: { object: paymentIntent } } as unknown as Stripe.Event;
}

beforeEach(async () => {
  await resetState();
  vi.clearAllMocks();
});

afterAll(async () => {
  await disconnectAll();
});

describe("stripe webhook reconciliation", () => {
  it("a replayed webhook finalizes the booking only once", async () => {
    const { seat } = await createEventWithSeat(3000);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: user.id,
        stripePaymentIntentId: "pi_duplicate",
        amountCents: 3000,
        status: "PENDING",
      },
    });

    const event = makeStripeEvent("evt_duplicate", "payment_intent.succeeded", {
      id: "pi_duplicate",
      metadata: { holdIds: JSON.stringify([hold.holdId]) },
    });

    await handleStripeWebhookEvent(event);
    await handleStripeWebhookEvent(event); // replay of the exact same event id

    const bookingCount = await prisma.booking.count({ where: { seatId: seat.id } });
    expect(bookingCount).toBe(1);

    const processedCount = await prisma.processedWebhookEvent.count({
      where: { stripeEventId: "evt_duplicate" },
    });
    expect(processedCount).toBe(1);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { holdId: hold.holdId },
    });
    expect(attempt.status).toBe("CONFIRMED");
  });

  it("a confirmation arriving after the hold already expired is rejected and refunded, not booked", async () => {
    const { seat } = await createEventWithSeat(1500);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: user.id,
        stripePaymentIntentId: "pi_late",
        amountCents: 1500,
        status: "PENDING",
      },
    });

    // Simulate the hold's Redis key having already expired naturally
    // before the confirmation arrived.
    await redis.del(seatHoldKey(seat.id));

    const event = makeStripeEvent("evt_late", "payment_intent.succeeded", {
      id: "pi_late",
      metadata: { holdIds: JSON.stringify([hold.holdId]) },
    });

    await handleStripeWebhookEvent(event);

    const bookingCount = await prisma.booking.count({ where: { seatId: seat.id } });
    expect(bookingCount).toBe(0);

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { holdId: hold.holdId },
    });
    expect(attempt.status).toBe("EXPIRED_BEFORE_CONFIRMATION");

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_late", amount: 1500 }),
      { idempotencyKey: `refund-expired-before-confirmation-${hold.holdId}-pi_late` },
    );
  });

  it("a second payment (different PaymentIntent) for an already-confirmed hold is refunded, not kept", async () => {
    const { seat } = await createEventWithSeat(2000);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: user.id,
        stripePaymentIntentId: "pi_first",
        amountCents: 2000,
        status: "PENDING",
      },
    });
    const metadata = { holdIds: JSON.stringify([hold.holdId]) };

    await handleStripeWebhookEvent(
      makeStripeEvent("evt_first", "payment_intent.succeeded", { id: "pi_first", metadata }),
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();

    // The user also paid a second, separate intent for the same seat.
    await handleStripeWebhookEvent(
      makeStripeEvent("evt_second", "payment_intent.succeeded", { id: "pi_second", metadata }),
    );

    expect(await prisma.booking.count({ where: { seatId: seat.id } })).toBe(1);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_second", amount: 2000 },
      { idempotencyKey: `refund-duplicate-payment-${hold.holdId}-pi_second` },
    );
  });

  it("checkout creates the PaymentIntent with a stable idempotency key for the same cart", async () => {
    const { seat } = await createEventWithSeat(2500);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({
      id: "pi_checkout",
      client_secret: "secret",
    } as never);
    const { createCheckout } = await import("../src/services/payment.service");

    await createCheckout(user.id, [hold.holdId]);
    await createCheckout(user.id, [hold.holdId]); // double-click / retry

    const calls = vi.mocked(stripe.paymentIntents.create).mock.calls;
    expect(calls).toHaveLength(2);
    const keys = calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toMatch(/^checkout-[0-9a-f]{64}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("a failed payment releases the hold and seat immediately, not on TTL", async () => {
    const { seat } = await createEventWithSeat(1200);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: user.id,
        stripePaymentIntentId: "pi_failed",
        amountCents: 1200,
        status: "PENDING",
      },
    });

    const event = makeStripeEvent("evt_failed", "payment_intent.payment_failed", {
      id: "pi_failed",
      metadata: { holdIds: JSON.stringify([hold.holdId]) },
    });

    await handleStripeWebhookEvent(event);

    expect(await redis.get(seatHoldKey(seat.id))).toBeNull();

    const updatedSeat = await prisma.seat.findUniqueOrThrow({ where: { id: seat.id } });
    expect(updatedSeat.status).toBe("AVAILABLE");

    const updatedHold = await prisma.hold.findUniqueOrThrow({ where: { id: hold.holdId } });
    expect(updatedHold.status).toBe("RELEASED");

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({
      where: { holdId: hold.holdId },
    });
    expect(attempt.status).toBe("FAILED");
  });
});
