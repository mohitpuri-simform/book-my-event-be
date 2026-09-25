import { MESSAGES } from "../constants/messages.constants";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import type { CreateEventInput, UpdateEventInput } from "../validation/event.schema";

export interface EventBookingStats {
  totalSeats: number;
  bookedSeats: number;
  availableSeats: number;
}

const EMPTY_STATS: EventBookingStats = { totalSeats: 0, bookedSeats: 0, availableSeats: 0 };

/**
 * Booked-vs-empty seat counts per event, for the organiser's "My events"
 * list and event-bookings pages. Seat totals come from `Section.rows *
 * Section.seatsPerRow` (a handful of section rows per event) rather than
 * `COUNT(*)` over `seats`, and booked counts come from a single grouped
 * aggregate over `bookings` — never a per-seat/per-booking scan in Node
 * (rule #7: no unbounded scans).
 */
async function getBookingStatsForEvents(
  eventIds: string[],
): Promise<Map<string, EventBookingStats>> {
  if (eventIds.length === 0) {
    return new Map();
  }

  const [sections, bookingCounts] = await Promise.all([
    prisma.section.findMany({
      where: { eventId: { in: eventIds } },
      select: { eventId: true, rows: true, seatsPerRow: true },
    }),
    prisma.booking.groupBy({
      by: ["eventId"],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    }),
  ]);

  const totalSeatsByEvent = new Map<string, number>();
  for (const section of sections) {
    totalSeatsByEvent.set(
      section.eventId,
      (totalSeatsByEvent.get(section.eventId) ?? 0) + section.rows * section.seatsPerRow,
    );
  }
  const bookedByEvent = new Map(bookingCounts.map((b) => [b.eventId, b._count._all]));

  const stats = new Map<string, EventBookingStats>();
  for (const eventId of eventIds) {
    const totalSeats = totalSeatsByEvent.get(eventId) ?? 0;
    const bookedSeats = bookedByEvent.get(eventId) ?? 0;
    stats.set(eventId, { totalSeats, bookedSeats, availableSeats: totalSeats - bookedSeats });
  }
  return stats;
}

export async function createEvent(organiserId: string, input: CreateEventInput) {
  return prisma.event.create({
    data: {
      name: input.name,
      venueStreet: input.venueStreet,
      venueCity: input.venueCity,
      venueState: input.venueState,
      date: input.date,
      endDate: input.endDate,
      organiserId,
    },
  });
}

export async function listEvents(page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      orderBy: { date: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count(),
  ]);

  return { items, total };
}

export async function listMyEvents(organiserId: string, page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where: { organiserId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count({ where: { organiserId } }),
  ]);

  const stats = await getBookingStatsForEvents(items.map((event) => event.id));
  const itemsWithStats = items.map((event) => ({
    ...event,
    ...(stats.get(event.id) ?? EMPTY_STATS),
  }));

  return { items: itemsWithStats, total };
}

export async function getEventById(eventId: string) {
  return prisma.event.findUnique({ where: { id: eventId } });
}

export async function getMyEventById(eventId: string, organiserId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });
  if (!event) {
    return null;
  }

  const stats = await getBookingStatsForEvents([eventId]);
  return { ...event, ...(stats.get(eventId) ?? EMPTY_STATS) };
}

export async function updateEvent(eventId: string, organiserId: string, input: UpdateEventInput) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });

  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }

  const nextDate = input.date ?? event.date;
  const nextEndDate = input.endDate ?? event.endDate;
  if (nextEndDate <= nextDate) {
    throw new ApiError(422, MESSAGES.events.invalidEndDate);
  }

  return prisma.event.update({ where: { id: eventId }, data: input });
}
