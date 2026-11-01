import type { Request } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "./http";

export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new HttpError(400, "请求参数不合法", "validation_error", result.error.flatten());
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    throw new HttpError(400, "查询参数不合法", "validation_error", result.error.flatten());
  }
  return result.data;
}
