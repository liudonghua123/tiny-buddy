import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import {
  bumpPromptUsage,
  createPrompt,
  deletePrompt,
  getPrompt,
  listPrompts,
  promptStats,
  updatePrompt,
} from "../services/prompts";

export const promptsRouter = Router();
promptsRouter.use(requireAuth);

const promptSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  body: z.string().min(1).max(20000),
  category: z.string().max(30).optional(),
  icon: z.string().max(30).optional(),
  tags: z.array(z.string().max(20)).max(8).optional(),
});

promptsRouter.get(
  "/",
  requirePermission("prompt:read"),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    res.json({ items: listPrompts({ q, category }), stats: promptStats() });
  }),
);

promptsRouter.get(
  "/:id",
  requirePermission("prompt:read"),
  asyncHandler(async (req, res) => {
    const prompt = getPrompt(req.params.id);
    if (!prompt) throw new HttpError(404, "模板不存在", "not_found");
    res.json({ prompt });
  }),
);

promptsRouter.post(
  "/",
  requirePermission("prompt:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(promptSchema, req);
    const prompt = createPrompt(body, req.user!.id);
    audit(req, "prompt.create", prompt.id, { title: prompt.title });
    res.status(201).json({ prompt });
  }),
);

promptsRouter.patch(
  "/:id",
  requirePermission("prompt:write"),
  asyncHandler(async (req, res) => {
    const current = getPrompt(req.params.id);
    if (!current) throw new HttpError(404, "模板不存在", "not_found");
    if (current.builtin) throw new HttpError(403, "内置模板不可编辑，可复制为团队模板", "builtin_readonly");
    const body = parseBody(promptSchema.partial(), req);
    const prompt = updatePrompt(req.params.id, body);
    audit(req, "prompt.update", req.params.id);
    res.json({ prompt });
  }),
);

promptsRouter.delete(
  "/:id",
  requirePermission("prompt:write"),
  asyncHandler(async (req, res) => {
    const current = getPrompt(req.params.id);
    if (!current) throw new HttpError(404, "模板不存在", "not_found");
    if (current.builtin) throw new HttpError(403, "内置模板不可删除", "builtin_readonly");
    deletePrompt(req.params.id);
    audit(req, "prompt.delete", req.params.id, { title: current.title });
    res.json({ ok: true });
  }),
);

/** 复制内置模板为自己的模板：内置内容保持稳定，团队可自由改 */
promptsRouter.post(
  "/:id/duplicate",
  requirePermission("prompt:write"),
  asyncHandler(async (req, res) => {
    const current = getPrompt(req.params.id);
    if (!current) throw new HttpError(404, "模板不存在", "not_found");
    const prompt = createPrompt(
      {
        title: `${current.title}（副本）`,
        description: current.description,
        body: current.body,
        category: current.category,
        icon: current.icon,
        tags: current.tags,
      },
      req.user!.id,
    );
    audit(req, "prompt.duplicate", prompt.id, { from: current.id });
    res.status(201).json({ prompt });
  }),
);

/** 使用计数：模板被插入输入框时调用，用于「常用模板」排序 */
promptsRouter.post(
  "/:id/use",
  requirePermission("prompt:read"),
  asyncHandler(async (req, res) => {
    const current = getPrompt(req.params.id);
    if (!current) throw new HttpError(404, "模板不存在", "not_found");
    bumpPromptUsage(current.id);
    res.json({ ok: true });
  }),
);
