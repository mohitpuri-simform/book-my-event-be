import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { seatHoldKey } from "../src/lib/seatHold";
import { disconnectAll, resetState } from "./helpers/db";
import { createEventWithSeat, createTestUser } from "./helpers/factories";

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  await disconnectAll();
});

describe("seat holds", () => {
  it("exactly one of two concurrent hold requests for the same seat succeeds (§6.1)", async () => {
    const { event, seat } = await createEventWithSeat();
    const userA = await createTestUser();
    const userB = await createTestUser();

    const [resA, resB] = await Promise.all([
      request(app).post(`/events/${event.id}/seats/${seat.id}/hold`).set("Cookie", userA.cookie),
      request(app).post(`/events/${event.id}/seats/${seat.id}/hold`).set("Cookie", userB.cookie),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const activeHoldCount = await prisma.hold.count({
      where: { seatId: seat.id, status: "ACTIVE" },
    });
    expect(activeHoldCount).toBe(1);
  });

  it("re-selecting a seat you already hold is idempotent, not a conflict (§6.4)", async () => {
    const { event, seat } = await createEventWithSeat();
    const user = await createTestUser();

    const first = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", user.cookie);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.data.holdId).toBe(first.body.data.holdId);
    expect(second.body.data.remainingTtlSeconds).toBeGreaterThan(0);

    const holdCount = await prisma.hold.count({ where: { seatId: seat.id } });
    expect(holdCount).toBe(1);
  });

  it("a different user is rejected with 'unavailable', not treated idempotently", async () => {
    const { event, seat } = await createEventWithSeat();
    const userA = await createTestUser();
    const userB = await createTestUser();

    const first = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", userA.cookie);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", userB.cookie);
    expect(second.status).toBe(409);
  });

  it("releasing a hold deletes the redis key and frees the seat immediately", async () => {
    const { event, seat } = await createEventWithSeat();
    const user = await createTestUser();

    const holdRes = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", user.cookie);
    const holdId = holdRes.body.data.holdId as string;

    const releaseRes = await request(app).delete(`/holds/${holdId}`).set("Cookie", user.cookie);
    expect(releaseRes.status).toBe(200);

    expect(await redis.get(seatHoldKey(seat.id))).toBeNull();

    const updatedSeat = await prisma.seat.findUniqueOrThrow({ where: { id: seat.id } });
    expect(updatedSeat.status).toBe("AVAILABLE");

    const updatedHold = await prisma.hold.findUniqueOrThrow({ where: { id: holdId } });
    expect(updatedHold.status).toBe("RELEASED");
  });

  it("a user cannot release another user's hold (IDOR)", async () => {
    const { event, seat } = await createEventWithSeat();
    const owner = await createTestUser();
    const attacker = await createTestUser();

    const holdRes = await request(app)
      .post(`/events/${event.id}/seats/${seat.id}/hold`)
      .set("Cookie", owner.cookie);
    const holdId = holdRes.body.data.holdId as string;

    const releaseRes = await request(app).delete(`/holds/${holdId}`).set("Cookie", attacker.cookie);
    expect(releaseRes.status).toBe(404);

    // The real owner's hold must be untouched.
    expect(await redis.get(seatHoldKey(seat.id))).not.toBeNull();
  });
});
