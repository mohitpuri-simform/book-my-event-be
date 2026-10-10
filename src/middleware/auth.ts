import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_COOKIE } from "../config/auth";
import type { Role } from "../../generated/prisma/client";
import { MESSAGES } from "../constants/messages.constants";
import { prisma } from "../lib/prisma";
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

/**
 * Like `authenticate`, but a request with no access token continues as an
 * anonymous visitor (`req.user` unset) instead of being rejected — for public
 * routes that show a little more to the signed-in owner (e.g. their own
 * draft event). A token that IS present but expired/invalid is still a 401, so
 * the client's refresh-and-retry flow kicks in rather than the owner silently
 * being treated as a stranger.
 */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.[ACCESS_TOKEN_COOKIE]) {
    next();
    return;
  }
  authenticate(req, res, next);
}

export function authorize(...allowedRoles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new ApiError(401, MESSAGES.auth.authenticationRequired));
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true },
      });

      if (!user) {
        next(new ApiError(401, MESSAGES.auth.userNoLongerExists));
        return;
      }

      if (!allowedRoles.includes(user.role)) {
        next(new ApiError(403, MESSAGES.auth.forbidden));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
