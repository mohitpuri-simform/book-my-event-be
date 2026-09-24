import { z } from "zod";

export const releaseHoldParamsSchema = z.object({
  holdId: z.string().min(1),
});

export type ReleaseHoldParams = z.infer<typeof releaseHoldParamsSchema>;
