import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { getUserById } from "../services/auth.service";
import { updateProfile } from "../services/profile.service";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { updateProfileSchema } from "../validation/profile.schema";

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await getUserById(req.user!.id);
  sendSuccess(res, { data: user });
});

export const patchProfile = asyncHandler(async (req: Request, res: Response) => {
  const input = updateProfileSchema.parse(req.body);
  const user = await updateProfile(req.user!.id, input);
  sendSuccess(res, { data: user, message: MESSAGES.profile.updated });
});
