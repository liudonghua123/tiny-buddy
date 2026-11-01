import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { isValidCron, nextRun } from "../lib/cron";
import { createSchedule, deleteSchedule, listSchedules, runScheduleNow, updateSchedule } from "../services/scheduler";

export const schedulesRouter = Router();
schedulesRouter.use(requireAuth);

const cronField = z.string().refine((v) => isValidCron(v), "cron 表达式不合法（需 5 段：分 时 日 月 周）");

schedulesRouter.get(
  "/",
  requirePermission("schedule:read"),
  asyncHandler(async (req, res) => {
    const isAdmin = req.user!.permissions.includes("*") || req.user!.permissions.includes("platform:admin");
    const items = listSchedules(isAdmin ? undefined : req.user!.id);
    res.json({
      items: items.map((s) => ({ ...s, nextRunAt: s.enabled ? s.nextRunAt ?? nextRun(s.cron)?.toISOString() ?? null : null })),
    });
  }),
);

schedulesRouter.post(
  "/",
  requirePermission("schedule:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(80),
        cron: cronField,
        prompt: z.string().min(4).max(4000),
        skillKey: z.string().nullable().optional(),
        timezone: z.string().optional(),
      }),
      req,
    );
    const schedule = createSchedule({ ...body, userId: req.user!.id });
    audit(req, "schedule.create", schedule.id, { cron: schedule.cron });
    res.status(201).json({ schedule });
  }),
);

schedulesRouter.patch(
  "/:id",
  requirePermission("schedule:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(80).optional(),
        cron: cronField.optional(),
        prompt: z.string().min(4).max(4000).optional(),
        skillKey: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
      req,
    );
    const schedule = updateSchedule(req.params.id, body);
    if (!schedule) throw new HttpError(404, "定时任务不存在", "not_found");
    audit(req, "schedule.update", schedule.id);
    res.json({ schedule });
  }),
);

schedulesRouter.delete(
  "/:id",
  requirePermission("schedule:write"),
  asyncHandler(async (req, res) => {
    if (!deleteSchedule(req.params.id)) throw new HttpError(404, "定时任务不存在", "not_found");
    audit(req, "schedule.delete", req.params.id);
    res.json({ ok: true });
  }),
);

schedulesRouter.post(
  "/:id/run",
  requirePermission("schedule:write"),
  asyncHandler(async (req, res) => {
    const result = await runScheduleNow(req.params.id);
    audit(req, "schedule.run", req.params.id, { ok: result.ok });
    res.json(result);
  }),
);
