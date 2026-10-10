import { MESSAGES } from "../constants/messages.constants";
import { EventStatus } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import { hasEventEnded } from "../utils/eventTime";
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

/**
 * Public list: upcoming events first (soonest first), then ended ones (most
 * recently ended first) — ended events stay visible but never push live ones
 * down the pages. Prisma can't order by "has this ended?", so the two groups
 * are paged as one sequence: the page window is filled from the upcoming
 * group, and whatever is left over from the ended group.
 */
export async function listEvents(page: number, limit: number) {
  const now = new Date();
  const upcomingWhere = { status: EventStatus.PUBLISHED, endDate: { gt: now } };
  const endedWhere = { status: EventStatus.PUBLISHED, endDate: { lte: now } };

  const [upcomingTotal, endedTotal] = await Promise.all([
    prisma.event.count({ where: upcomingWhere }),
    prisma.event.count({ where: endedWhere }),
  ]);

  const skip = (page - 1) * limit;

  const upcoming =
    skip < upcomingTotal
      ? await prisma.event.findMany({
          where: upcomingWhere,
          orderBy: [{ date: "asc" }, { id: "asc" }],
          skip,
          take: limit,
        })
      : [];

  const remaining = limit - upcoming.length;
  const ended =
    remaining > 0
      ? await prisma.event.findMany({
          where: endedWhere,
          orderBy: [{ endDate: "desc" }, { id: "asc" }],
          skip: Math.max(0, skip - upcomingTotal),
          take: remaining,
        })
      : [];

  return { items: [...upcoming, ...ended], total: upcomingTotal + endedTotal };
}

export async function listMyEvents(organiserId: string, page: number, limit: number) {
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where: { organiserId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

/**
 * Public event lookup. A DRAFT event is visible only to the organiser who owns
 * it — to everyone else it behaves exactly like a non-existent event (null),
 * so drafts can't be discovered by guessing ids.
 */
export async function getEventById(eventId: string, viewerId?: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;
  if (event.status === EventStatus.DRAFT && event.organiserId !== viewerId) return null;
  return event;
}

export async function publishEvent(eventId: string, organiserId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });
  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  if (event.status === EventStatus.PUBLISHED) {
    return event;
  }
  if (hasEventEnded(event)) {
    throw new ApiError(422, MESSAGES.events.cannotPublishEnded);
  }

  const sectionCount = await prisma.section.count({ where: { eventId } });
  if (sectionCount === 0) {
    throw new ApiError(422, MESSAGES.events.noSectionsToPublish);
  }

  return prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.PUBLISHED } });
}

/**
 * Takes an event back to DRAFT. Refused once anyone has actually bought a
 * ticket — hiding an event people hold tickets for would strand those
 * bookings. Seats already held mid-checkout are left to expire or finish on
 * their own; new holds are rejected
 */
export async function unpublishEvent(eventId: string, organiserId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });
  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  if (event.status === EventStatus.DRAFT) {
    return event;
  }

  const bookingCount = await prisma.booking.count({ where: { eventId } });
  if (bookingCount > 0) {
    throw new ApiError(409, MESSAGES.events.cannotUnpublishWithBookings);
  }

  return prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.DRAFT } });
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
