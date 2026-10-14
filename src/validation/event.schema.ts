import { expiryCutoff } from "../utils/eventTime";
import { z } from "zod";
import { MESSAGES } from "../constants/messages.constants";
import { paginationQuerySchema } from "./pagination.schema";

export const createEventSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    venueStreet: z.string().trim().min(2).max(200),
    venueCity: z.string().trim().min(2).max(100),
    venueState: z.string().trim().min(2).max(100),
    date: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((data) => data.endDate >= data.date, {
    message: "endDate must not be before date",
    path: ["endDate"],
  })
  // Only on create: you can't open an event that is already over. Updates are
  // deliberately exempt so an organiser can still edit a started or ended event.
  .refine((data) => data.endDate >= expiryCutoff(), {
    message: MESSAGES.events.endDateInPast,
    path: ["endDate"],
  });

const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");

// Filter on the event's start day (inclusive on both ends).
export const listEventsQuerySchema = paginationQuerySchema
  .extend({ startFrom: dayParam.optional(), startTo: dayParam.optional() })
  .refine((q) => !q.startFrom || !q.startTo || q.startFrom <= q.startTo, {
    message: "startFrom must not be after startTo",
    path: ["startTo"],
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
  .refine((data) => !data.date || !data.endDate || data.endDate >= data.date, {
    message: "endDate must not be before date",
    path: ["endDate"],
  });

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
