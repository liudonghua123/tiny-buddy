import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "../services/skills";

export const skillsRouter = Router();
skillsRouter.use(requireAuth);

const skillSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "只能使用小写字母、数字与短横线"),
  name: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  icon: z.string().max(30).optional(),
  category: z.string().max(30).optional(),
  instructions: z.string().max(12000).optional(),
  tools: z.array(z.string()).optional(),
  resources: z.array(z.object({ name: z.string(), content: z.string() })).optional(),
  triggers: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

skillsRouter.get(
  "/",
  requirePermission("skill:read"),
  asyncHandler(async (_req, res) => {
    res.json({ items: listSkills() });
  }),
);

skillsRouter.get(
  "/:key",
  requirePermission("skill:read"),
  asyncHandler(async (req, res) => {
    const skill = getSkill(req.params.key);
    if (!skill) throw new HttpError(404, "技能不存在", "not_found");
    res.json({ skill });
  }),
);

skillsRouter.post(
  "/",
  requirePermission("skill:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(skillSchema, req);
    if (getSkill(body.key)) throw new HttpError(409, "技能 key 已存在", "duplicate_key");
    const skill = createSkill(body, req.user!.id);
    audit(req, "skill.create", skill.key);
    res.status(201).json({ skill });
  }),
);

skillsRouter.patch(
  "/:id",
  requirePermission("skill:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(skillSchema.partial().omit({ key: true }), req);
    const current = dbLookup(req.params.id);
    if (!current) throw new HttpError(404, "技能不存在", "not_found");
    if (current.builtin && body.enabled === false) {
      // 内置技能允许停用，但不允许删除
    }
    const skill = updateSkill(req.params.id, body);
    if (!skill) throw new HttpError(404, "技能不存在", "not_found");
    audit(req, "skill.update", skill.key);
    res.json({ skill });
  }),
);

skillsRouter.delete(
  "/:id",
  requirePermission("skill:write"),
  asyncHandler(async (req, res) => {
    if (!deleteSkill(req.params.id)) throw new HttpError(400, "内置技能不可删除，可改为停用", "builtin_protected");
    audit(req, "skill.delete", req.params.id);
    res.json({ ok: true });
  }),
);

function dbLookup(id: string) {
  const rows = listSkills();
  return rows.find((s) => s.id === id);
}
