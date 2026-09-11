import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_COOKIE } from "../config/auth";
import type { Role } from "../../generated/prisma/client";
import { MESSAGES } from "../constants/messages.constants";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;

  if (!token) {
    next(new ApiError(401, MESSAGES.auth.authenticationRequired));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new ApiError(401, MESSAGES.auth.accessTokenExpired));
      return;
    }
    next(new ApiError(401, MESSAGES.auth.invalidAccessToken));
  }
}

export function authorize(...allowedRoles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, MESSAGES.auth.authenticationRequired));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ApiError(403, MESSAGES.auth.forbidden));
      return;
    }

    next();
  };
}
