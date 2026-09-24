import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { buildPaginationMeta, sendSuccess } from "../utils/response";
import { listEventsQuerySchema } from "../validation/event.schema";
import { getMyEventById, listMyEvents } from "../services/event.service";

export const getMyEvents = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = listEventsQuerySchema.parse(req.query);
  const { items, total } = await listMyEvents(req.user!.id, page, limit);
  sendSuccess(res, {
    data: items,
    message: MESSAGES.events.fetchSuccess,
    meta: { pagination: buildPaginationMeta(page, limit, total) },
  });
});

export const getMyEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await getMyEventById(req.params.eventId!, req.user!.id);
  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  sendSuccess(res, { data: event, message: MESSAGES.events.fetchSuccess });
});
