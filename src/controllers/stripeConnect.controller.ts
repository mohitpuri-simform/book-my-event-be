import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { createOnboardingLink } from "../services/stripeConnect.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

export const postConnectStripeAccount = asyncHandler(async (req: Request, res: Response) => {
  const url = await createOnboardingLink(req.user!.id);
  sendSuccess(res, { data: { url }, message: MESSAGES.stripeConnect.onboardingLinkSuccess });
});
