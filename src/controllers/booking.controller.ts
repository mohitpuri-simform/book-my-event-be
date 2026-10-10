import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import {
  getMyBookingById,
  listBookingsForOrganiserEvent,
  listMyBookings,
} from "../services/booking.service";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { buildPaginationMeta, sendSuccess } from "../utils/response";
import { paginationQuerySchema } from "../validation/pagination.schema";

export const getMyBookings = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = paginationQuerySchema.parse(req.query);
  const { items, total } = await listMyBookings(req.user!.id, page, limit);
  sendSuccess(res, {
    data: items,
    message: MESSAGES.bookings.fetchSuccess,
    meta: { pagination: buildPaginationMeta(page, limit, total) },
  });
});

export const getMyBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await getMyBookingById(req.user!.id, req.params.bookingId!);
  if (!booking) {
    throw new ApiError(404, MESSAGES.bookings.notFound);
  }
  sendSuccess(res, { data: booking, message: MESSAGES.bookings.fetchSuccess });
});

export const getOrganiserEventBookings = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = paginationQuerySchema.parse(req.query);
  const result = await listBookingsForOrganiserEvent(
    req.params.eventId!,
    req.user!.id,
    page,
    limit,
  );
  if (result === null) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  sendSuccess(res, {
    data: result.items,
    message: MESSAGES.bookings.fetchSuccess,
    meta: { pagination: buildPaginationMeta(page, limit, result.total) },
  });
});
