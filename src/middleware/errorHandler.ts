import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MESSAGES } from "../constants/messages.constants";
import type { ApiErrorBody } from "../types/apiResponse";
import { ApiError } from "../utils/ApiError";

function sendError(res: Response, statusCode: number, body: ApiErrorBody): void {
  res.status(statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, {
    success: false,
    message: MESSAGES.server.routeNotFound(req.method, req.originalUrl),
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    sendError(res, 400, {
      success: false,
      message: MESSAGES.validation.validationFailed,
      errors: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }

  if (err instanceof ApiError) {
    sendError(res, err.statusCode, {
      success: false,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  console.error(err);
  sendError(res, 500, { success: false, message: MESSAGES.server.internalError });
}
