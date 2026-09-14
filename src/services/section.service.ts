import { MESSAGES } from "../constants/messages.constants";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/ApiError";
import type {
  CreateSectionInput,
  ReorderSectionsInput,
  UpdateSectionInput,
} from "../validation/section.schema";

export async function createSectionWithSeats(
  eventId: string,
  organiserId: string,
  input: CreateSectionInput,
) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, organiserId },
    });

    if (!event) {
      throw new ApiError(404, MESSAGES.events.notFound);
    }

    const existingSectionCount = await tx.section.count({ where: { eventId } });

    const section = await tx.section.create({
      data: {
        eventId,
        name: input.name,
        rows: input.rows,
        seatsPerRow: input.seatsPerRow,
        priceCents: input.priceCents,
        aisleAfterSeat: input.aisleAfterSeat ?? null,
        displayOrder: existingSectionCount,
      },
    });

    const seatData = [];
    for (let row = 1; row <= input.rows; row++) {
      for (let col = 1; col <= input.seatsPerRow; col++) {
        seatData.push({
          sectionId: section.id,
          row,
          col,
          priceCents: input.priceCents,
        });
      }
    }

    const seats = await tx.seat.createManyAndReturn({ data: seatData });

    return { ...section, seats };
  });
}

export async function listSectionsForEvent(eventId: string) {
  return prisma.section.findMany({
    where: { eventId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: {
      seats: {
        orderBy: [{ row: "asc" }, { col: "asc" }],
      },
    },
  });
}

export async function updateSection(
  eventId: string,
  sectionId: string,
  organiserId: string,
  input: UpdateSectionInput,
) {
  return prisma.$transaction(async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: sectionId, eventId, event: { organiserId } },
    });

    if (!section) {
      throw new ApiError(404, MESSAGES.sections.notFound);
    }

    const updated = await tx.section.update({
      where: { id: sectionId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.priceCents !== undefined && { priceCents: input.priceCents }),
      },
    });

    if (input.priceCents !== undefined) {
      await tx.seat.updateMany({
        where: { sectionId, status: "AVAILABLE" },
        data: { priceCents: input.priceCents },
      });
    }

    return updated;
  });
}

export async function reorderSections(
  eventId: string,
  organiserId: string,
  input: ReorderSectionsInput,
) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, organiserId } });

    if (!event) {
      throw new ApiError(404, MESSAGES.events.notFound);
    }

    const existingSections = await tx.section.findMany({
      where: { eventId },
      select: { id: true },
    });

    const existingIds = new Set(existingSections.map((s) => s.id));
    const providedIds = new Set(input.sectionIds);

    if (
      existingIds.size !== providedIds.size ||
      input.sectionIds.length !== providedIds.size ||
      [...existingIds].some((id) => !providedIds.has(id))
    ) {
      throw new ApiError(400, MESSAGES.sections.invalidReorder);
    }

    await Promise.all(
      input.sectionIds.map((sectionId, index) =>
        tx.section.update({ where: { id: sectionId }, data: { displayOrder: index } }),
      ),
    );

    return tx.section.findMany({
      where: { eventId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      include: {
        seats: {
          orderBy: [{ row: "asc" }, { col: "asc" }],
        },
      },
    });
  });
}

export async function deleteSection(eventId: string, sectionId: string, organiserId: string) {
  return prisma.$transaction(async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: sectionId, eventId, event: { organiserId } },
    });

    if (!section) {
      throw new ApiError(404, MESSAGES.sections.notFound);
    }

    const nonAvailableSeats = await tx.seat.count({
      where: { sectionId, status: { not: "AVAILABLE" } },
    });

    if (nonAvailableSeats > 0) {
      throw new ApiError(409, MESSAGES.sections.cannotDeleteHeldOrBooked);
    }

    await tx.section.delete({ where: { id: sectionId } });
  });
}
