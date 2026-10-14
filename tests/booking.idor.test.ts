import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { disconnectAll, resetState } from "./helpers/db";
import { createBookingFor, createEventWithSeat, createTestUser } from "./helpers/factories";

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  await disconnectAll();
});

async function setupBooking() {
  const { event, seat, organiser } = await createEventWithSeat();
  const owner = await createTestUser();
  const booking = await createBookingFor(owner.id, seat, event.id);
  return { event, seat, organiser, owner, booking };
}

describe("user booking scoping (IDOR)", () => {
  it("a user can fetch their own booking by id", async () => {
    const { owner, booking } = await setupBooking();

    const res = await request(app).get(`/me/bookings/${booking.id}`).set("Cookie", owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(booking.id);
    expect(res.body.data.ticketRef).toBe(booking.ticketRef);
  });

  it("another user cannot fetch someone else's booking by id", async () => {
    const { booking } = await setupBooking();
    const attacker = await createTestUser();

    const res = await request(app).get(`/me/bookings/${booking.id}`).set("Cookie", attacker.cookie);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(booking.ticketRef);
  });

  it("someone else's booking never appears in a user's /me/bookings list", async () => {
    const { booking } = await setupBooking();
    const other = await createTestUser();

    const res = await request(app).get("/me/bookings").set("Cookie", other.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.data.find((b: { id: string }) => b.id === booking.id)).toBeUndefined();
  });

  it("an organiser cannot read a buyer's booking via /me/bookings/:id either", async () => {
    const { booking, organiser } = await setupBooking();

    const res = await request(app)
      .get(`/me/bookings/${booking.id}`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(404);
  });

  it("an unauthenticated request for a booking is rejected", async () => {
    const { booking } = await setupBooking();

    const res = await request(app).get(`/me/bookings/${booking.id}`);

    expect(res.status).toBe(401);
  });
});

describe("organiser booking scoping (IDOR)", () => {
  it("an organiser sees the bookings for their own event", async () => {
    const { event, organiser, booking } = await setupBooking();

    const res = await request(app)
      .get(`/organiser/events/${event.id}/bookings`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual([booking.id]);
  });

  it("another organiser cannot list bookings for an event they don't own", async () => {
    const { event, booking } = await setupBooking();
    const otherOrganiser = await createTestUser("ORGANISER");

    const res = await request(app)
      .get(`/organiser/events/${event.id}/bookings`)
      .set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(booking.ticketRef);
  });

  it("a regular user cannot use the organiser bookings endpoint, even for a ticket they own", async () => {
    const { event, owner } = await setupBooking();

    const res = await request(app)
      .get(`/organiser/events/${event.id}/bookings`)
      .set("Cookie", owner.cookie);

    expect(res.status).toBe(403);
  });

  it("an unauthenticated request to the organiser bookings endpoint is rejected", async () => {
    const { event } = await setupBooking();

    const res = await request(app).get(`/organiser/events/${event.id}/bookings`);

    expect(res.status).toBe(401);
  });
});
