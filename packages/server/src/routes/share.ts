import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Message, SessionShare, SharedSession } from "@tiny-buddy/shared";
import { db, now, parseJson } from "../db";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { rateLimit } from "../lib/rateLimit";
import { parseBody } from "../lib/validate";

/* --------------------------- 作者侧：管理分享链接 --------------------------- */
export const shareRouter = Router();
shareRouter.use(requireAuth);

function readShare(row: Record<string, unknown>): SessionShare {
  const token = (row.share_token as string | null) ?? null;
  const expiresAt = (row.share_expires_at as string | null) ?? null;
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
  const active = Boolean(token) && !expired;
  return {
    active,
    token: active ? token : null,
    path: active ? `/s/${token}` : null,
    createdAt: (row.shared_at as string | null) ?? null,
    expiresAt,
    viewCount: Number(row.share_views ?? 0),
  };
}

function ownedSession(id: string, userId: string): Record<string, unknown> {
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(id, userId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new HttpError(404, "会话不存在", "not_found");
  return row;
}

shareRouter.get(
  "/:id/share",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const row = ownedSession(req.params.id, req.user!.id);
    res.json(readShare(row));
  }),
);

shareRouter.post(
  "/:id/share",
  requirePermission("session:share"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        /** 有效期天数：0 = 长期有效，上限 90 天 */
        expiresInDays: z.number().int().min(0).max(90).optional(),
        /** true 则重新生成 token，旧链接立即失效 */
        rotate: z.boolean().optional(),
      }),
      req,
    );
    const row = ownedSession(req.params.id, req.user!.id);
    const current = readShare(row);
    const days = body.expiresInDays ?? 7;
    const expiresAt = days === 0 ? null : new Date(Date.now() + days * 86_400_000).toISOString();

    let token = current.token;
    if (!token || body.rotate) {
      token = crypto.randomBytes(16).toString("base64url");
      db.prepare(`UPDATE sessions SET share_token = ?, share_expires_at = ?, shared_at = ?, share_views = 0 WHERE id = ?`).run(
        token,
        expiresAt,
        now(),
        req.params.id,
      );
      audit(req, body.rotate ? "session.share_rotate" : "session.share", req.params.id);
    } else {
      // 已开启：仅续期 / 调整有效期
      db.prepare(`UPDATE sessions SET share_expires_at = ? WHERE id = ?`).run(expiresAt, req.params.id);
      audit(req, "session.share_update", req.params.id);
    }

    res.json({
      active: true,
      token,
      path: `/s/${token}`,
      createdAt: (db.prepare(`SELECT shared_at FROM sessions WHERE id = ?`).get(req.params.id) as { shared_at: string })
        .shared_at,
      expiresAt,
      viewCount: 0,
    } satisfies SessionShare);
  }),
);

shareRouter.delete(
  "/:id/share",
  requirePermission("session:share"),
  asyncHandler(async (req, res) => {
    ownedSession(req.params.id, req.user!.id);
    db.prepare(`UPDATE sessions SET share_token = NULL, share_expires_at = NULL, shared_at = NULL, share_views = 0 WHERE id = ?`).run(
      req.params.id,
    );
    audit(req, "session.share_revoke", req.params.id);
    res.json({ ok: true });
  }),
);

/* ----------------------------- 访客侧：公开读取 ----------------------------- */
export const publicShareRouter = Router();

/** 分享页只暴露必要字段：工具入参与返回内容属于内部细节，一律裁掉 */
function sanitizeParts(parts: Message["parts"]): Message["parts"] {
  return (parts ?? []).map((p) => {
    if (p.type !== "tool") return p;
    return {
      type: "tool",
      id: p.id,
      name: p.name,
      ...(p.title ? { title: p.title } : {}),
      input: {},
      status: p.status,
      ...(p.durationMs !== undefined ? { durationMs: p.durationMs } : {}),
      ...(p.source ? { source: p.source } : {}),
    } satisfies Message["parts"][number];
  });
}

publicShareRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? "unknown";
    const limit = rateLimit(`share:${ip}`, 60, 60_000);
    if (!limit.ok) throw new HttpError(429, "访问过于频繁，请稍后再试", "rate_limited");

    const row = db
      .prepare(
        `SELECT s.*, u.name AS owner_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.share_token = ?`,
      )
      .get(req.params.token) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "分享链接不存在或已撤销", "share_not_found");

    const expiresAt = (row.share_expires_at as string | null) ?? null;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      throw new HttpError(410, "分享链接已过期", "share_expired");
    }

    const rows = db
      .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500`)
      .all(String(row.id)) as Record<string, unknown>[];

    db.prepare(`UPDATE sessions SET share_views = share_views + 1 WHERE id = ?`).run(String(row.id));

    const payload: SharedSession = {
      token: req.params.token,
      title: String(row.title),
      ownerName: String(row.owner_name ?? ""),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      expiresAt,
      messages: rows.map((r) => ({
        id: String(r.id),
        role: r.role as Message["role"],
        content: String(r.content ?? ""),
        parts: sanitizeParts(parseJson<Message["parts"]>(r.parts as string, [])),
        createdAt: String(r.created_at),
      })),
    };

    res.setHeader("cache-control", "no-store");
    res.json(payload);
  }),
);
