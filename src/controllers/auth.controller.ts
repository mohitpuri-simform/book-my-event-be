import type { Request, Response } from "express";
import { REFRESH_TOKEN_COOKIE } from "../config/auth";
import { MESSAGES } from "../constants/messages.constants";
import {
  getUserById,
  issueTokens,
  registerUser,
  requestPasswordReset,
  resetPassword,
  revokeRefreshToken,
  rotateRefreshToken,
  validateCredentials,
} from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/ApiError";
import { clearAuthCookies, setAuthCookies } from "../utils/cookies";
import { sendSuccess } from "../utils/response";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../validation/auth.schema";

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const user = await registerUser(input);
  const tokens = await issueTokens(user.id, user.role);

  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
  sendSuccess(res, { statusCode: 201, data: user });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const user = await validateCredentials(input.email, input.password);
  const tokens = await issueTokens(user.id, user.role);

  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
  sendSuccess(res, { data: user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
  if (!token) {
    throw new ApiError(401, MESSAGES.auth.noRefreshTokenProvided);
  }

  const { accessToken, refreshToken, user } = await rotateRefreshToken(token);
  setAuthCookies(res, accessToken, refreshToken);
  sendSuccess(res, { data: user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
  if (token) {
    await revokeRefreshToken(token);
  }

  clearAuthCookies(res);
  sendSuccess(res, { message: MESSAGES.auth.logoutSuccess });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await getUserById(req.user!.id);
  sendSuccess(res, { data: user });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const input = forgotPasswordSchema.parse(req.body);
  await requestPasswordReset(input.email);
  sendSuccess(res, { message: MESSAGES.otp.otpSentIfAccountExists });
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const input = resetPasswordSchema.parse(req.body);
  await resetPassword(input.email, input.otp, input.newPassword);
  sendSuccess(res, { message: MESSAGES.otp.passwordResetSuccess });
});
