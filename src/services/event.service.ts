import { MESSAGES } from "../constants/messages.constants";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import type { CreateEventInput, UpdateEventInput } from "../validation/event.schema";

export async function createEvent(organiserId: string, input: CreateEventInput) {
  return prisma.event.create({
    data: {
      name: input.name,
      venue: input.venue,
      date: input.date,
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

  return { items, total };
}

export async function getEventById(eventId: string) {
  return prisma.event.findUnique({ where: { id: eventId } });
}

export async function updateEvent(eventId: string, organiserId: string, input: UpdateEventInput) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organiserId } });

  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }

  return prisma.event.update({ where: { id: eventId }, data: input });
}
