/** 用量洞察：把 runs / messages / skills 聚合成可直接渲染的概览 */
import { Router } from "express";
import { z } from "zod";
import type { UsageDay, UsageOverview, UsageRunRow } from "@tiny-buddy/shared";
import { hasPermission } from "@tiny-buddy/shared";
import { db, parseJson } from "../db";
import { asyncHandler, requireAuth, requirePermission } from "../lib/http";

export const usageRouter = Router();
usageRouter.use(requireAuth);

function parseDays(value: unknown): number {
  const parsed = z.coerce.number().int().min(3).max(90).safeParse(value ?? 14);
  return parsed.success ? parsed.data : 14;
}

/** 按服务器本地时区归日，避免 UTC 与本地时区错位导致「今天」跑到昨天 */
function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 运行记录里的指令可能带附件正文，展示前只保留人类可读的部分 */
function cleanInput(text: string): string {
  return text.replace(/<attachment[\s\S]*?(<\/attachment>|$)/g, " ").replace(/\s+/g, " ").trim();
}

usageRouter.get(
  "/overview",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);
    const platform = req.query.scope === "platform" && hasPermission(req.user!.permissions, ["audit:read"]);
    const userId = req.user!.id;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const from = start.toISOString();

    const runs = (
      platform
        ? db.prepare(`SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC`).all(from)
        : db.prepare(`SELECT * FROM runs WHERE user_id = ? AND started_at >= ? ORDER BY started_at DESC`).all(userId, from)
    ) as Record<string, unknown>[];

    const messageRows = (
      platform
        ? db.prepare(`SELECT created_at FROM messages WHERE created_at >= ?`).all(from)
        : db
            .prepare(
              `SELECT m.created_at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.user_id = ? AND m.created_at >= ?`,
            )
            .all(userId, from)
    ) as { created_at: string }[];

    const toolRows = (
      platform
        ? db.prepare(`SELECT parts FROM messages WHERE role = 'assistant' AND created_at >= ? LIMIT 5000`).all(from)
        : db
            .prepare(
              `SELECT m.parts FROM messages m JOIN sessions s ON s.id = m.session_id
               WHERE s.user_id = ? AND m.role = 'assistant' AND m.created_at >= ? LIMIT 5000`,
            )
            .all(userId, from)
    ) as { parts: string }[];

    const sessionCount = platform
      ? (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n
      : (db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId) as { n: number }).n;

    // 逐日骨架：先建空桶，保证没有数据的日子也出现在趋势图里
    const series: UsageDay[] = [];
    const index = new Map<string, UsageDay>();
    for (let i = 0; i < days; i++) {
      const cursor = new Date(start);
      cursor.setDate(start.getDate() + i);
      const date = dayKey(cursor);
      const day: UsageDay = { date, runs: 0, messages: 0, toolCalls: 0, tokens: 0, failed: 0 };
      series.push(day);
      index.set(date, day);
    }

    let tokens = 0;
    let toolCalls = 0;
    let success = 0;
    let failed = 0;
    let durationSum = 0;
    let durationCount = 0;
    const kinds = new Map<string, { kind: string; runs: number; tokens: number }>();
    const recent: UsageRunRow[] = [];

    for (const run of runs) {
      const startedAt = String(run.started_at);
      const day = index.get(dayKey(startedAt));
      const usage = parseJson<{ totalTokens?: number }>(run.usage as string, {});
      const runTokens = Number(usage.totalTokens ?? 0);
      const runTools = Number(run.tool_calls ?? 0);
      const status = String(run.status);

      tokens += runTokens;
      toolCalls += runTools;
      if (status === "success") success += 1;
      else if (status === "failed" || status === "cancelled") failed += 1;

      if (run.finished_at) {
        const ms = new Date(String(run.finished_at)).getTime() - new Date(startedAt).getTime();
        if (Number.isFinite(ms) && ms >= 0) {
          durationSum += ms;
          durationCount += 1;
        }
      }

      if (day) {
        day.runs += 1;
        day.toolCalls += runTools;
        day.tokens += runTokens;
        if (status === "failed" || status === "cancelled") day.failed += 1;
      }

      const kind = String(run.kind ?? "chat");
      const bucket = kinds.get(kind) ?? { kind, runs: 0, tokens: 0 };
      bucket.runs += 1;
      bucket.tokens += runTokens;
      kinds.set(kind, bucket);

      if (recent.length < 12) {
        recent.push({
          id: String(run.id),
          kind,
          status,
          input: cleanInput(String(run.input ?? "")).slice(0, 120),
          steps: Number(run.steps ?? 0),
          toolCalls: runTools,
          tokens: runTokens,
          durationMs: run.finished_at ? Math.max(0, new Date(String(run.finished_at)).getTime() - new Date(startedAt).getTime()) : 0,
          startedAt,
        });
      }
    }

    for (const row of messageRows) {
      const day = index.get(dayKey(row.created_at));
      if (day) day.messages += 1;
    }

    // 工具热度：从已落库的 parts 里统计调用次数与平均耗时
    const toolStats = new Map<string, { count: number; totalMs: number }>();
    for (const row of toolRows) {
      const parts = parseJson<{ type: string; name?: string; durationMs?: number }[]>(row.parts, []);
      for (const part of parts) {
        if (part.type !== "tool" || !part.name) continue;
        const entry = toolStats.get(part.name) ?? { count: 0, totalMs: 0 };
        entry.count += 1;
        entry.totalMs += Number(part.durationMs ?? 0);
        toolStats.set(part.name, entry);
      }
    }

    const topTools = [...toolStats.entries()]
      .map(([name, v]) => ({ name, count: v.count, avgMs: Math.round(v.totalMs / v.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // 技能使用按「绑定过该技能的会话数」统计：比全局计数器更贴近个人视角，也能反映种子数据
    const skillRows = (
      platform
        ? db
            .prepare(
              `SELECT s.skill_key AS key, COALESCE(k.name, s.skill_key) AS name, COUNT(*) AS usage
               FROM sessions s LEFT JOIN skills k ON k.key = s.skill_key
               WHERE s.skill_key IS NOT NULL
               GROUP BY s.skill_key ORDER BY usage DESC LIMIT 5`,
            )
            .all()
        : db
            .prepare(
              `SELECT s.skill_key AS key, COALESCE(k.name, s.skill_key) AS name, COUNT(*) AS usage
               FROM sessions s LEFT JOIN skills k ON k.key = s.skill_key
               WHERE s.skill_key IS NOT NULL AND s.user_id = ?
               GROUP BY s.skill_key ORDER BY usage DESC LIMIT 5`,
            )
            .all(userId)
    ) as { key: string; name: string; usage: number }[];
    const topSkills = skillRows.map((s) => ({ key: s.key, name: s.name, usage: Number(s.usage) }));

    const overview: UsageOverview = {
      range: { days, from, to: new Date().toISOString(), scope: platform ? "platform" : "me" },
      totals: {
        runs: runs.length,
        messages: messageRows.length,
        sessions: sessionCount,
        tokens,
        toolCalls,
        successRate: success + failed > 0 ? Math.round((success / (success + failed)) * 1000) / 10 : 0,
        avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : 0,
      },
      series,
      byKind: [...kinds.values()].sort((a, b) => b.runs - a.runs),
      topTools,
      topSkills,
      recent,
    };

    res.json(overview);
  }),
);
