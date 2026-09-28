import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { getWalletSummary, withdrawAvailableBalance } from "../services/wallet.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  const summary = await getWalletSummary(req.user!.id);
  sendSuccess(res, { data: summary, message: MESSAGES.wallet.fetchSuccess });
});

export const postWithdraw = asyncHandler(async (req: Request, res: Response) => {
  const withdrawal = await withdrawAvailableBalance(req.user!.id);
  sendSuccess(res, { data: withdrawal, message: MESSAGES.wallet.withdrawSuccess });
});
