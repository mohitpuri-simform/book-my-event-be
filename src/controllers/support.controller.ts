import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { createSupportTicket } from "../services/support.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { createSupportTicketSchema } from "../validation/support.schema";

export const postSupportTicket = asyncHandler(async (req: Request, res: Response) => {
  const input = createSupportTicketSchema.parse(req.body);
  await createSupportTicket(req.user?.id ?? null, input);
  sendSuccess(res, { statusCode: 202, message: MESSAGES.support.ticketReceived });
});
