import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { holdSeat, listMyHolds, releaseHold } from "../services/hold.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { releaseHoldParamsSchema } from "../validation/hold.schema";

export const postSeatHold = asyncHandler(async (req: Request, res: Response) => {
  const result = await holdSeat(req.user!.id, req.params.seatId!);
  sendSuccess(res, {
    statusCode: result.idempotent ? 200 : 201,
    data: result,
    message: MESSAGES.holds.holdSuccess,
  });
});

export const deleteHold = asyncHandler(async (req: Request, res: Response) => {
  const { holdId } = releaseHoldParamsSchema.parse(req.params);
  await releaseHold(req.user!.id, holdId, "RELEASED");
  sendSuccess(res, { message: MESSAGES.holds.releaseSuccess });
});

export const getMyHolds = asyncHandler(async (req: Request, res: Response) => {
  const { holds, effectiveExpiresAt } = await listMyHolds(req.user!.id);
  sendSuccess(res, { data: { holds, effectiveExpiresAt }, message: MESSAGES.holds.fetchSuccess });
});
