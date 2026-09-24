import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { listBookingsForOrganiserEvent, listMyBookings } from "../services/booking.service";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

export const getMyBookings = asyncHandler(async (req: Request, res: Response) => {
  const bookings = await listMyBookings(req.user!.id);
  sendSuccess(res, { data: bookings, message: MESSAGES.bookings.fetchSuccess });
});

export const getOrganiserEventBookings = asyncHandler(async (req: Request, res: Response) => {
  const bookings = await listBookingsForOrganiserEvent(req.params.eventId!, req.user!.id);
  if (bookings === null) {
    throw new ApiError(404, MESSAGES.events.notFound);
  }
  sendSuccess(res, { data: bookings, message: MESSAGES.bookings.fetchSuccess });
});
