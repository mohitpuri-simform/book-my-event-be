import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";
import { disconnectAll, resetState } from "./helpers/db";
import { createEventWithSeat, createTestUser } from "./helpers/factories";

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  await disconnectAll();
});

describe("organiser event scoping (IDOR)", () => {
  it("an organiser can fetch their own event via /organiser/events/:eventId", async () => {
    const { event, organiser } = await createEventWithSeat();

    const res = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(event.id);
  });

  it("an organiser cannot fetch another organiser's event via /organiser/events/:eventId", async () => {
    const { event } = await createEventWithSeat();
    const otherOrganiser = await createTestUser("ORGANISER");

    const res = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(404);
  });

  it("another organiser's event does not appear in /organiser/events", async () => {
    const { event } = await createEventWithSeat();
    const otherOrganiser = await createTestUser("ORGANISER");

    const res = await request(app).get("/organiser/events").set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.find((e: { id: string }) => e.id === event.id)).toBeUndefined();
  });
});

describe("organiser event booking stats", () => {
  it("reports booked vs total vs available seats, from section dimensions and a booking count aggregate", async () => {
    const organiser = await createTestUser("ORGANISER");
    const event = await prisma.event.create({
      data: {
        name: "Stats Event",
        venueStreet: "1 Test St",
        venueCity: "Test City",
        venueState: "Test State",
        date: new Date(Date.now() + 86400000),
        endDate: new Date(Date.now() + 90000000),
        organiserId: organiser.id,
      },
    });
    const section = await prisma.section.create({
      data: {
        eventId: event.id,
        name: "GA",
        rows: 2,
        seatsPerRow: 2,
        priceCents: 1000,
        displayOrder: 0,
      },
    });

    const seats = await Promise.all([
      prisma.seat.create({ data: { sectionId: section.id, row: 1, col: 1, priceCents: 1000 } }),
      prisma.seat.create({ data: { sectionId: section.id, row: 1, col: 2, priceCents: 1000 } }),
      prisma.seat.create({ data: { sectionId: section.id, row: 2, col: 1, priceCents: 1000 } }),
      prisma.seat.create({ data: { sectionId: section.id, row: 2, col: 2, priceCents: 1000 } }),
    ]);

    const buyer = await createTestUser();
    const hold = await prisma.hold.create({
      data: {
        id: randomUUID(),
        seatId: seats[0]!.id,
        userId: buyer.id,
        status: "CONFIRMED",
        expiresAt: new Date(),
      },
    });
    await prisma.booking.create({
      data: {
        holdId: hold.id,
        seatId: seats[0]!.id,
        userId: buyer.id,
        eventId: event.id,
        priceCents: 1000,
        ticketRef: "TKT-STATS1",
      },
    });

    const listRes = await request(app).get("/organiser/events").set("Cookie", organiser.cookie);
    const listed = listRes.body.data.find((e: { id: string }) => e.id === event.id);
    expect(listed).toMatchObject({ totalSeats: 4, bookedSeats: 1, availableSeats: 3 });

    const detailRes = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", organiser.cookie);
    expect(detailRes.body.data).toMatchObject({ totalSeats: 4, bookedSeats: 1, availableSeats: 3 });
  });

  it("reports zero booked seats for an event with no bookings yet", async () => {
    const { event, organiser } = await createEventWithSeat();

    const res = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", organiser.cookie);

    expect(res.body.data).toMatchObject({ totalSeats: 1, bookedSeats: 0, availableSeats: 1 });
  });
});
