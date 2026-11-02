/** 定时任务调度器：30s 轮询，到点触发 Agent 运行 */
import type { Schedule } from "@tiny-buddy/shared";
import { db, newId, now } from "../db";
import { loadUser } from "../lib/auth";
import { nextRun } from "../lib/cron";
import { runAgent } from "./agent";

const running = new Set<string>();
let timer: NodeJS.Timeout | null = null;

export function listSchedules(userId?: string): Schedule[] {
  const rows = (userId
    ? db.prepare(`SELECT * FROM schedules WHERE created_by = ? ORDER BY created_at DESC`).all(userId)
    : db.prepare(`SELECT * FROM schedules ORDER BY created_at DESC`).all()) as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    cron: String(r.cron),
    timezone: String(r.timezone ?? "Asia/Shanghai"),
    prompt: String(r.prompt),
    skillKey: (r.skill_key as string) ?? null,
    enabled: Boolean(r.enabled),
    lastRunAt: (r.last_run_at as string) ?? null,
    nextRunAt: (r.next_run_at as string) ?? null,
    lastStatus: (r.last_status as Schedule["lastStatus"]) ?? null,
    createdBy: String(r.created_by ?? ""),
    createdAt: String(r.created_at),
  }));
}

export function createSchedule(input: {
  name: string;
  cron: string;
  prompt: string;
  timezone?: string;
  skillKey?: string | null;
  userId: string;
}): Schedule {
  const id = newId("sch");
  const next = nextRun(input.cron);
  db.prepare(
    `INSERT INTO schedules (id, name, cron, timezone, prompt, skill_key, enabled, next_run_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.cron,
    input.timezone ?? "Asia/Shanghai",
    input.prompt,
    input.skillKey ?? null,
    next?.toISOString() ?? null,
    input.userId,
    now(),
  );
  return listSchedules(input.userId).find((s) => s.id === id) as Schedule;
}

export function updateSchedule(
  id: string,
  patch: Partial<Pick<Schedule, "name" | "cron" | "prompt" | "enabled" | "skillKey">>,
): Schedule | null {
  const row = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const cronExpr = patch.cron ?? String(row.cron);
  const enabled = patch.enabled ?? Boolean(row.enabled);
  const next = enabled ? nextRun(cronExpr) : null;
  db.prepare(
    `UPDATE schedules SET name = ?, cron = ?, prompt = ?, skill_key = ?, enabled = ?, next_run_at = ? WHERE id = ?`,
  ).run(
    patch.name ?? String(row.name),
    cronExpr,
    patch.prompt ?? String(row.prompt),
    patch.skillKey !== undefined ? patch.skillKey : (row.skill_key as string | null),
    enabled ? 1 : 0,
    next?.toISOString() ?? null,
    id,
  );
  return listSchedules().find((s) => s.id === id) ?? null;
}

export function deleteSchedule(id: string): boolean {
  return db.prepare(`DELETE FROM schedules WHERE id = ?`).run(id).changes > 0;
}

/** 立即运行一次（不影响既定周期） */
export async function runScheduleNow(id: string): Promise<{ ok: boolean; output: string }> {
  const row = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as Record<string, string | number> | undefined;
  if (!row) return { ok: false, output: "任务不存在" };
  return execute(String(row.id), String(row.name), String(row.prompt), String(row.created_by), (row.skill_key as string) || null);
}

async function execute(
  scheduleId: string,
  name: string,
  prompt: string,
  userId: string,
  skillKey: string | null,
): Promise<{ ok: boolean; output: string }> {
  if (running.has(scheduleId)) return { ok: false, output: "任务正在运行中" };
  running.add(scheduleId);
  const startedAt = now();
  db.prepare(`UPDATE schedules SET last_run_at = ?, last_status = 'running' WHERE id = ?`).run(startedAt, scheduleId);

  try {
    const user = loadUser(userId);
    if (!user) throw new Error("任务创建者已不存在");

    let session = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get(`sch_${scheduleId}`) as { id: string } | undefined;
    if (!session) {
      db.prepare(`INSERT INTO sessions (id, user_id, title, agent_key, created_at, updated_at) VALUES (?, ?, ?, 'buddy', ?, ?)`).run(
        `sch_${scheduleId}`,
        user.id,
        `⏱ ${name}`,
        startedAt,
        startedAt,
      );
    }
    db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(startedAt, `sch_${scheduleId}`);

    let output = "";
    let failed = false;
    for await (const event of runAgent({
      user,
      sessionId: `sch_${scheduleId}`,
      input: prompt,
      skillKey,
      kind: "schedule",
      refId: scheduleId,
    })) {
      if (event.type === "message.end") output = event.message.content;
      if (event.type === "error") {
        failed = true;
        output = event.message;
      }
    }

    const next = nextRun(
      (db.prepare(`SELECT cron FROM schedules WHERE id = ?`).get(scheduleId) as { cron: string }).cron,
    );
    db.prepare(`UPDATE schedules SET last_status = ?, next_run_at = ? WHERE id = ?`).run(
      failed ? "failed" : "success",
      next?.toISOString() ?? null,
      scheduleId,
    );
    return { ok: !failed, output };
  } catch (err) {
    db.prepare(`UPDATE schedules SET last_status = 'failed' WHERE id = ?`).run(scheduleId);
    return { ok: false, output: (err as Error).message };
  } finally {
    running.delete(scheduleId);
  }
}

export async function tick(): Promise<void> {
  const due = db
    .prepare(`SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?`)
    .all(now()) as Record<string, string | number>[];

  for (const row of due) {
    const id = String(row.id);
    const cron = String(row.cron);
    const next = nextRun(cron);
    db.prepare(`UPDATE schedules SET next_run_at = ? WHERE id = ?`).run(next?.toISOString() ?? null, id);
    void execute(id, String(row.name), String(row.prompt), String(row.created_by), (row.skill_key as string) || null);
  }
}

export function startScheduler(): void {
  if (timer) return;
  // 补齐缺失的下次执行时间
  const rows = db.prepare(`SELECT id, cron, enabled FROM schedules`).all() as { id: string; cron: string; enabled: number }[];
  for (const row of rows) {
    if (!row.enabled) continue;
    const next = nextRun(row.cron);
    db.prepare(`UPDATE schedules SET next_run_at = ? WHERE id = ?`).run(next?.toISOString() ?? null, row.id);
  }
  timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, 30_000);
  console.log("[scheduler] started (30s tick)");
}

/** 调度器是否在运行（健康检查用） */
export function schedulerRunning(): boolean {
  return timer !== null;
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

