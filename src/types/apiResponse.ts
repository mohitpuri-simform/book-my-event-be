export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

export interface ApiSuccessBody<T = unknown> {
  success: true;
  message?: string;
  data?: T;
  meta?: ResponseMeta;
}

export interface ApiErrorField {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  errors?: ApiErrorField[];
}
