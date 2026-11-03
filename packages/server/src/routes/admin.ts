import { Router } from "express";
import { z } from "zod";
import { ALL_PERMISSIONS, ROLE_PRESETS, hasPermission } from "@tiny-buddy/shared";
import { db, parseJson } from "../db";
import { asyncHandler, requireAuth, requirePermission } from "../lib/http";
import { parseQuery } from "../lib/validate";
import { agentInfo, providerInfo } from "../services/agent";
import { knowledgeStats } from "../services/knowledge";
import { mcpStats } from "../services/mcp";
import { skillStats } from "../services/skills";
import { memoryStats } from "../services/memory";
import { env } from "../env";

export const metaRouter = Router();
metaRouter.use(requireAuth);

metaRouter.get(
  "/meta",
  asyncHandler(async (req, res) => {
    res.json({
      agent: agentInfo(),
      provider: providerInfo(),
      permissions: ALL_PERMISSIONS,
      roles: ROLE_PRESETS,
      version: env.version,
    });
  }),
);

metaRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const isAdmin = hasPermission(user.permissions, "audit:read");

    const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;

    const users = isAdmin ? count(`SELECT COUNT(*) AS n FROM users`) : 1;
    const sessions = isAdmin
      ? count(`SELECT COUNT(*) AS n FROM sessions`)
      : count(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`, user.id);
    const messages = isAdmin
      ? count(`SELECT COUNT(*) AS n FROM messages`)
      : count(`SELECT COUNT(*) AS n FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.user_id = ?`, user.id);
    const memories = isAdmin ? count(`SELECT COUNT(*) AS n FROM memories`) : count(`SELECT COUNT(*) AS n FROM memories WHERE user_id = ?`, user.id);
    const runs24h = isAdmin
      ? count(`SELECT COUNT(*) AS n FROM runs WHERE started_at >= ?`, new Date(Date.now() - 86400000).toISOString())
      : count(
          `SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND started_at >= ?`,
          user.id,
          new Date(Date.now() - 86400000).toISOString(),
        );

    const usageRows = db
      .prepare(`SELECT usage FROM runs WHERE started_at >= ? ${isAdmin ? "" : "AND user_id = ?"}`)
      .all(...(isAdmin ? [new Date(Date.now() - 86400000).toISOString()] : [new Date(Date.now() - 86400000).toISOString(), user.id])) as {
      usage: string | null;
    }[];
    const tokens24h = usageRows.reduce((sum, r) => sum + (parseJson<{ totalTokens?: number }>(r.usage, {})?.totalTokens ?? 0), 0);

    const mcp = mcpStats();
    res.json({
      users,
      sessions,
      messages,
      memories,
      runs24h,
      tokens24h,
      ...knowledgeStats(),
      mcpServers: mcp.total,
      mcpTools: mcp.tools,
      skills: skillStats().total,
      schedules: isAdmin ? count(`SELECT COUNT(*) AS n FROM schedules`) : count(`SELECT COUNT(*) AS n FROM schedules WHERE created_by = ?`, user.id),
    });
  }),
);

metaRouter.get(
  "/memory/overview",
  asyncHandler(async (req, res) => {
    res.json(memoryStats(req.user!.id));
  }),
);

export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get(
  "/audit",
  requirePermission("audit:read"),
  asyncHandler(async (req, res) => {
    const query = parseQuery(z.object({ page: z.coerce.number().min(1).optional(), pageSize: z.coerce.number().max(100).optional() }), req);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM audit_logs`).get() as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
    res.json({
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: String(r.id),
        userId: (r.user_id as string) ?? null,
        userName: (r.user_name as string) ?? (r.user_email as string) ?? "系统",
        action: String(r.action),
        target: (r.target as string) ?? null,
        meta: parseJson<Record<string, unknown> | null>(r.meta as string, null),
        ip: (r.ip as string) ?? null,
        createdAt: String(r.created_at),
      })),
    });
  }),
);

adminRouter.get(
  "/runs",
  requirePermission("audit:read"),
  asyncHandler(async (req, res) => {
    const query = parseQuery(z.object({ limit: z.coerce.number().min(1).max(100).optional() }), req);
    const rows = db
      .prepare(
        `SELECT r.*, u.name AS user_name FROM runs r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.started_at DESC LIMIT ?`,
      )
      .all(query.limit ?? 30) as Record<string, unknown>[];
    res.json({
      items: rows.map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        status: String(r.status),
        input: String(r.input ?? "").slice(0, 160),
        output: String(r.output ?? "").slice(0, 400),
        steps: Number(r.steps ?? 0),
        toolCalls: Number(r.tool_calls ?? 0),
        usage: parseJson<Record<string, number> | null>(r.usage as string, null),
        error: (r.error as string) ?? null,
        startedAt: String(r.started_at),
        finishedAt: (r.finished_at as string) ?? null,
        userName: (r.user_name as string) ?? null,
      })),
    });
  }),
);
