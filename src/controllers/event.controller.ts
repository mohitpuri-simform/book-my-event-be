import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { buildPaginationMeta, sendSuccess } from "../utils/response";
import {
  createEventSchema,
  listEventsQuerySchema,
  updateEventSchema,
} from "../validation/event.schema";
import {
  createEvent,
  getEventById,
  listEvents,
  publishEvent,
  unpublishEvent,
  updateEvent,
} from "../services/event.service";

export const postEvent = asyncHandler(async (req: Request, res: Response) => {
  const input = createEventSchema.parse(req.body);
  const event = await createEvent(req.user!.id, input);
  sendSuccess(res, { statusCode: 201, data: event, message: MESSAGES.events.createSuccess });
});

export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = listEventsQuerySchema.parse(req.query);
  const { items, total } = await listEvents(page, limit);
  sendSuccess(res, {
    data: items,
    message: MESSAGES.events.fetchSuccess,
    meta: { pagination: buildPaginationMeta(page, limit, total) },
  });
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await getEventById(req.params.eventId!, req.user?.id);
  if (!event) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  sendSuccess(res, { data: event, message: MESSAGES.events.fetchSuccess });
});

export const patchEvent = asyncHandler(async (req: Request, res: Response) => {
  const input = updateEventSchema.parse(req.body);
  const event = await updateEvent(req.params.eventId!, req.user!.id, input);
  sendSuccess(res, { data: event, message: MESSAGES.events.updateSuccess });
});

export const postPublishEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await publishEvent(req.params.eventId!, req.user!.id);
  sendSuccess(res, { data: event, message: MESSAGES.events.publishSuccess });
});

export const postUnpublishEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await unpublishEvent(req.params.eventId!, req.user!.id);
  sendSuccess(res, { data: event, message: MESSAGES.events.unpublishSuccess });
});
