import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { createCheckout, getCheckoutStatus } from "../services/payment.service";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { createCheckoutSchema } from "../validation/checkout.schema";

export const postCheckout = asyncHandler(async (req: Request, res: Response) => {
  const input = createCheckoutSchema.parse(req.body);
  const result = await createCheckout(req.user!.id, input.holdIds);
  sendSuccess(res, { statusCode: 201, data: result, message: MESSAGES.checkout.checkoutSuccess });
});

export const getCheckoutStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const attempts = await getCheckoutStatus(req.user!.id, req.params.paymentIntentId!);
  if (!attempts) {
    throw new ApiError(404, MESSAGES.checkout.statusNotFound);
  }
  sendSuccess(res, { data: { attempts }, message: MESSAGES.checkout.statusFetchSuccess });
});
