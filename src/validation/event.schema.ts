import { z } from "zod";

export const createEventSchema = z.object({
  name: z.string().trim().min(2).max(150),
  venue: z.string().trim().min(2).max(200),
  date: z.coerce.date(),
});

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const updateEventSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    venue: z.string().trim().min(2).max(200).optional(),
    date: z.coerce.date().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
