import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

function generateTicketRef(): string {
  return `TKT-${randomUUID().split("-")[0]!.toUpperCase()}`;
}

const MY_BOOKING_INCLUDE = {
  event: {
    select: {
      id: true,
      name: true,
      venueStreet: true,
      venueCity: true,
      venueState: true,
      date: true,
      endDate: true,
    },
  },
  seat: {
    select: {
      row: true,
      col: true,
      section: { select: { name: true, rows: true } },
    },
  },
} as const;

// `id` as a tie-breaker: bookings created in the same millisecond (one cart
// checkout creates several) would otherwise sort arbitrarily, so a row could
// repeat or vanish across page boundaries.
const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }] as const;

export async function listMyBookings(userId: string, page: number, limit: number) {
  const where = { userId };

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: [...NEWEST_FIRST],
      skip: (page - 1) * limit,
      take: limit,
      include: MY_BOOKING_INCLUDE,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
}

/** Scoped by `userId` in the query itself, so another user's booking id is just a 404. */
export async function getMyBookingById(userId: string, bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: MY_BOOKING_INCLUDE,
  });
}

export async function listBookingsForOrganiserEvent(
  eventId: string,
  organiserId: string,
  page: number,
  limit: number,
) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });
  if (!event) {
    return null;
  }

  const where = { eventId };

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: [...NEWEST_FIRST],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true } },
        seat: {
          select: {
            row: true,
            col: true,
            section: { select: { name: true, rows: true } },
          },
        },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
}

export { generateTicketRef };
