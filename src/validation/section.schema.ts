import { z } from "zod";
import { MESSAGES } from "../constants/messages.constants";

export const MAX_SECTION_ROWS = 50;
export const MAX_SECTION_SEATS_PER_ROW = 50;
export const MAX_SECTION_SEATS = 500;

export const createSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rows: z.number().int().min(1).max(MAX_SECTION_ROWS),
    seatsPerRow: z.number().int().min(1).max(MAX_SECTION_SEATS_PER_ROW),
    priceCents: z.number().int().min(0),
    aisleAfterSeat: z.number().int().min(1).nullable().optional(),
  })
  .refine((data) => data.rows * data.seatsPerRow <= MAX_SECTION_SEATS, {
    message: MESSAGES.sections.tooManySeats,
    path: ["rows"],
  })
  .refine((data) => data.aisleAfterSeat == null || data.aisleAfterSeat <= data.seatsPerRow - 1, {
    message: MESSAGES.sections.invalidAisle,
    path: ["aisleAfterSeat"],
  });

export const updateSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    priceCents: z.number().int().min(0).optional(),
  })
  .refine((data) => data.name !== undefined || data.priceCents !== undefined, {
    message: "At least one field must be provided",
  });

export const reorderSectionsSchema = z.object({
  sectionIds: z.array(z.string()).min(1),
});

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type ReorderSectionsInput = z.infer<typeof reorderSectionsSchema>;
