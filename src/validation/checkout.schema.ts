import { z } from "zod";

export const createCheckoutSchema = z.object({
  holdIds: z.array(z.string().min(1)).min(1).max(20),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
