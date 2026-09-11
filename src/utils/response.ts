import type { Response } from "express";
import type { ApiSuccessBody, PaginationMeta, ResponseMeta } from "../types/apiResponse";

interface SendSuccessOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T;
  meta?: ResponseMeta;
}

export function sendSuccess<T>(res: Response, options: SendSuccessOptions<T> = {}): void {
  const { statusCode = 200, message, data, meta } = options;

  const body: ApiSuccessBody<T> = { success: true };
  if (message !== undefined) body.message = message;
  if (data !== undefined) body.data = data;
  if (meta !== undefined) body.meta = meta;

  res.status(statusCode).json(body);
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
