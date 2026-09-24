import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { disconnectAll, resetState } from "./helpers/db";
import { createEventWithSeat, createTestUser } from "./helpers/factories";

const { holdSeat } = await import("../src/services/hold.service");

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  await disconnectAll();
});

describe("checkout status", () => {
  it("reports a voided payment attempt so the frontend can stop polling and show it", async () => {
    const { seat } = await createEventWithSeat(1500);
    const user = await createTestUser();
    const hold = await holdSeat(user.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: user.id,
        stripePaymentIntentId: "pi_status_voided",
        amountCents: 1500,
        status: "EXPIRED_BEFORE_CONFIRMATION",
      },
    });

    const res = await request(app)
      .get("/checkout/pi_status_voided/status")
      .set("Cookie", user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.attempts).toEqual([
      { holdId: hold.holdId, status: "EXPIRED_BEFORE_CONFIRMATION" },
    ]);
  });

  it("404s for a payment intent with no attempts for this user", async () => {
    const user = await createTestUser();

    const res = await request(app).get("/checkout/pi_unknown/status").set("Cookie", user.cookie);

    expect(res.status).toBe(404);
  });

  it("never returns another user's payment attempt (IDOR)", async () => {
    const { seat } = await createEventWithSeat(1500);
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const hold = await holdSeat(owner.id, seat.id);

    await prisma.paymentAttempt.create({
      data: {
        holdId: hold.holdId,
        userId: owner.id,
        stripePaymentIntentId: "pi_status_owner",
        amountCents: 1500,
        status: "PENDING",
      },
    });

    const res = await request(app)
      .get("/checkout/pi_status_owner/status")
      .set("Cookie", attacker.cookie);

    expect(res.status).toBe(404);
  });
});
