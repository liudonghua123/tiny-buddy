import { Router } from "express";
import { z } from "zod";
import type { Message, Session } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

function toSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    title: String(row.title),
    agentKey: String(row.agent_key ?? "buddy"),
    skillKey: (row.skill_key as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count ?? 0),
    preview: (row.preview as string) ?? undefined,
  };
}

sessionsRouter.get(
  "/",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*, 
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
          (SELECT substr(content, 1, 80) FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1) AS preview
         FROM sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT 100`,
      )
      .all(req.user!.id) as Record<string, unknown>[];
    res.json({ items: rows.map(toSession) });
  }),
);

sessionsRouter.post(
  "/",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ title: z.string().max(80).optional(), skillKey: z.string().nullable().optional() }), req);
    const id = newId("ses");
    const ts = now();
    db.prepare(
      `INSERT INTO sessions (id, user_id, title, agent_key, skill_key, created_at, updated_at) VALUES (?, ?, ?, 'buddy', ?, ?, ?)`,
    ).run(id, req.user!.id, body.title?.trim() || "新对话", body.skillKey ?? null, ts, ts);
    res.status(201).json({ session: toSession(db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<string, unknown>) });
  }),
);

sessionsRouter.get(
  "/:id",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as
      | Record<string, unknown>
      | undefined;
    if (!session) throw new HttpError(404, "会话不存在", "not_found");

    const rows = db
      .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500`)
      .all(req.params.id) as Record<string, unknown>[];

    const messages: Message[] = rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      role: r.role as Message["role"],
      content: String(r.content ?? ""),
      parts: parseJson<Message["parts"]>(r.parts as string, []),
      createdAt: String(r.created_at),
      usage: parseJson<Message["usage"]>(r.usage as string, null),
      model: (r.model as string) ?? null,
    }));

    res.json({ session: toSession(session), messages });
  }),
);

sessionsRouter.patch(
  "/:id",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ title: z.string().min(1).max(80).optional(), skillKey: z.string().nullable().optional() }), req);
    const session = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id) as
      | Record<string, unknown>
      | undefined;
    if (!session) throw new HttpError(404, "会话不存在", "not_found");
    db.prepare(`UPDATE sessions SET title = ?, skill_key = ?, updated_at = ? WHERE id = ?`).run(
      body.title ?? String(session.title),
      body.skillKey !== undefined ? body.skillKey : (session.skill_key as string | null),
      now(),
      req.params.id,
    );
    res.json({ ok: true });
  }),
);

sessionsRouter.delete(
  "/:id",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const changes = db.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`).run(req.params.id, req.user!.id).changes;
    if (!changes) throw new HttpError(404, "会话不存在", "not_found");
    audit(req, "session.delete", req.params.id);
    res.json({ ok: true });
  }),
);
