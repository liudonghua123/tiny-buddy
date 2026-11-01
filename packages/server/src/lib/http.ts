import type { NextFunction, Request, Response } from "express";
import type { Permission, User } from "@tiny-buddy/shared";
import { hasPermission } from "@tiny-buddy/shared";
import { db, newId, now } from "../db";
import { loadUser, verifyApiKey, verifyToken } from "./auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      authKind?: "jwt" | "apikey";
      apiScopes?: string[];
    }
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return next(new HttpError(401, "未登录", "unauthorized"));
  const userId = verifyToken(token);
  if (!userId) return next(new HttpError(401, "登录已过期，请重新登录", "token_invalid"));
  const user = loadUser(userId);
  if (!user) return next(new HttpError(401, "用户不存在", "user_not_found"));
  req.user = user;
  req.authKind = "jwt";
  next();
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "未登录", "unauthorized"));
    if (!hasPermission(req.user.permissions, perms)) {
      return next(new HttpError(403, "没有权限执行该操作", "forbidden", { required: perms }));
    }
    next();
  };
}

/** MCP 端点：支持 API Key 或 JWT */
export function authenticateMcp(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return next(new HttpError(401, "缺少访问令牌", "unauthorized"));

  if (token.startsWith("tb_")) {
    const key = verifyApiKey(token);
    if (!key) return next(new HttpError(401, "API Key 无效或已吊销", "invalid_api_key"));
    const user = loadUser(key.userId);
    if (!user) return next(new HttpError(401, "用户不存在", "user_not_found"));
    req.user = user;
    req.apiScopes = key.scopes;
    req.authKind = "apikey";
    return next();
  }

  const userId = verifyToken(token);
  if (!userId) return next(new HttpError(401, "令牌无效", "invalid_token"));
  const user = loadUser(userId);
  if (!user) return next(new HttpError(401, "用户不存在", "user_not_found"));
  req.user = user;
  req.authKind = "jwt";
  next();
}

export function audit(
  req: { user?: User; ip?: string; headers?: Record<string, unknown> },
  action: string,
  target?: string,
  meta?: Record<string, unknown>,
): void {
  const forwarded = req.headers?.["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === "string" ? forwarded.split(",")[0] : req.ip ?? null;
  auditAs(req.user?.id ?? null, action, target, meta, ip ?? null);
}

export function auditAs(
  userId: string | null,
  action: string,
  target?: string,
  meta?: Record<string, unknown>,
  ip?: string | null,
): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, target, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("log"), userId, action, target ?? null, meta ? JSON.stringify(meta) : null, ip ?? null, now());
  } catch {
    /* 审计失败不影响主流程 */
  }
}

export function requireScope(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "未登录", "unauthorized"));
    const inRole = hasPermission(req.user.permissions, permission);
    const inScopes = !req.apiScopes?.length || req.apiScopes.includes(permission) || req.apiScopes.includes("*");
    if (!inRole || !inScopes) {
      return next(new HttpError(403, `缺少权限：${permission}`, "forbidden", { required: permission }));
    }
    next();
  };
}
