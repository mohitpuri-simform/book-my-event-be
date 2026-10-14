import { randomUUID } from "node:crypto";
import { ACCESS_TOKEN_COOKIE } from "../../src/config/auth";
import type { Role } from "../../generated/prisma/client";
import { prisma } from "../../src/lib/prisma";
import { signAccessToken } from "../../src/utils/jwt";

export interface TestUser {
  id: string;
  cookie: string;
}

export async function createTestUser(role: Role = "USER"): Promise<TestUser> {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@test.local`,
      password: "not-used-in-tests",
      name: "Test User",
      role,
    },
  });

  const token = signAccessToken({ sub: user.id, role: user.role });
  return { id: user.id, cookie: `${ACCESS_TOKEN_COOKIE}=${token}` };
}

export async function createEventWithSeat(priceCents = 2500) {
  const organiser = await createTestUser("ORGANISER");

  const event = await prisma.event.create({
    data: {
      name: "Test Event",
      venueStreet: "123 Test St",
      venueCity: "Test City",
      venueState: "Test State",
      date: new Date(Date.now() + 86400000),
      endDate: new Date(Date.now() + 90000000),
      status: "PUBLISHED",
      organiserId: organiser.id,
    },
  });

  const section = await prisma.section.create({
    data: { eventId: event.id, name: "GA", rows: 1, seatsPerRow: 1, priceCents, displayOrder: 0 },
  });

  const seat = await prisma.seat.create({
    data: { sectionId: section.id, row: 1, col: 1, priceCents, status: "AVAILABLE" },
  });

  return { organiser, event, section, seat };
}

/** A finalised booking (hold CONFIRMED + seat BOOKED) for `userId` on the given seat. */
export async function createBookingFor(
  userId: string,
  seat: { id: string; priceCents: number },
  eventId: string,
) {
  const hold = await prisma.hold.create({
    data: {
      id: randomUUID(),
      seatId: seat.id,
      userId,
      status: "CONFIRMED",
      expiresAt: new Date(),
    },
  });
  await prisma.seat.update({ where: { id: seat.id }, data: { status: "BOOKED" } });
  return prisma.booking.create({
    data: {
      holdId: hold.id,
      seatId: seat.id,
      userId,
      eventId,
      priceCents: seat.priceCents,
      ticketRef: `TKT-${randomUUID().slice(0, 8).toUpperCase()}`,
    },
  });
}
