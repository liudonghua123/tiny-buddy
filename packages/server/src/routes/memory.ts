import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody, parseQuery } from "../lib/validate";
import {
  deleteMemory,
  listMemories,
  memoryStats,
  recallMemories,
  updateMemory,
  writeMemory,
} from "../services/memory";

export const memoryRouter = Router();
memoryRouter.use(requireAuth);

memoryRouter.get(
  "/",
  requirePermission("memory:read"),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      z.object({
        q: z.string().optional(),
        kind: z.string().optional(),
        page: z.coerce.number().min(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).optional(),
      }),
      req,
    );
    const { items, total } = listMemories(req.user!.id, query);
    res.json({ items, total, page: query.page ?? 1, pageSize: query.pageSize ?? 30 });
  }),
);

memoryRouter.get(
  "/stats",
  requirePermission("memory:read"),
  asyncHandler(async (req, res) => {
    res.json(memoryStats(req.user!.id));
  }),
);

memoryRouter.get(
  "/search",
  requirePermission("memory:read"),
  asyncHandler(async (req, res) => {
    const query = parseQuery(z.object({ q: z.string().min(1), limit: z.coerce.number().min(1).max(20).optional() }), req);
    res.json({ items: recallMemories({ userId: req.user!.id, query: query.q, limit: query.limit ?? 8 }) });
  }),
);

memoryRouter.post(
  "/",
  requirePermission("memory:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        content: z.string().min(2).max(4000),
        kind: z.enum(["fact", "preference", "episode", "procedure", "entity"]).optional(),
        scope: z.enum(["user", "session", "global"]).optional(),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
      }),
      req,
    );
    const result = writeMemory({ userId: req.user!.id, ...body, source: "manual" });
    audit(req, "memory.write", result.memory.id);
    res.status(201).json(result);
  }),
);

memoryRouter.patch(
  "/:id",
  requirePermission("memory:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        content: z.string().min(2).max(4000).optional(),
        kind: z.enum(["fact", "preference", "episode", "procedure", "entity"]).optional(),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
      }),
      req,
    );
    const memory = updateMemory(req.user!.id, req.params.id, body);
    if (!memory) throw new HttpError(404, "记忆不存在", "not_found");
    audit(req, "memory.update", memory.id);
    res.json({ memory });
  }),
);

memoryRouter.delete(
  "/:id",
  requirePermission("memory:delete"),
  asyncHandler(async (req, res) => {
    if (!deleteMemory(req.user!.id, req.params.id)) throw new HttpError(404, "记忆不存在", "not_found");
    audit(req, "memory.delete", req.params.id);
    res.json({ ok: true });
  }),
);
