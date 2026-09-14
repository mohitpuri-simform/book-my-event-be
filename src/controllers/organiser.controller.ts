import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { asyncHandler } from "../utils/asyncHandler";
import { buildPaginationMeta, sendSuccess } from "../utils/response";
import { listEventsQuerySchema } from "../validation/event.schema";
import { listMyEvents } from "../services/event.service";

export const getMyEvents = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = listEventsQuerySchema.parse(req.query);
  const { items, total } = await listMyEvents(req.user!.id, page, limit);
  sendSuccess(res, {
    data: items,
    message: MESSAGES.events.fetchSuccess,
    meta: { pagination: buildPaginationMeta(page, limit, total) },
  });
});
