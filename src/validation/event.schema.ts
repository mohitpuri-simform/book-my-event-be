import { z } from "zod";

export const createEventSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    venueStreet: z.string().trim().min(2).max(200),
    venueCity: z.string().trim().min(2).max(100),
    venueState: z.string().trim().min(2).max(100),
    date: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate > data.date, {
    message: "endDate must be after date",
    path: ["endDate"],
  });

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const updateEventSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    venueStreet: z.string().trim().min(2).max(200).optional(),
    venueCity: z.string().trim().min(2).max(100).optional(),
    venueState: z.string().trim().min(2).max(100).optional(),
    date: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  })
  .refine((data) => !data.date || !data.endDate || data.endDate > data.date, {
    message: "endDate must be after date",
    path: ["endDate"],
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
