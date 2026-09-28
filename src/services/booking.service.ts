import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";

function generateTicketRef(): string {
  return `TKT-${randomUUID().split("-")[0]!.toUpperCase()}`;
}

export async function listMyBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
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
    },
  });
}

export async function listBookingsForOrganiserEvent(eventId: string, organiserId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });
  if (!event) {
    return null;
  }

  return prisma.booking.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
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
  });
}

export { generateTicketRef };
