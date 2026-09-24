import { z } from "zod";

export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(3).max(2000),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
