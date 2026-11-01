import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody, parseQuery } from "../lib/validate";
import {
  addDocument,
  createKnowledgeBase,
  deleteDocument,
  deleteKnowledgeBase,
  listDocuments,
  listKnowledgeBases,
  searchKnowledge,
} from "../services/knowledge";

export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth);

knowledgeRouter.get(
  "/bases",
  requirePermission("knowledge:read"),
  asyncHandler(async (_req, res) => {
    res.json({ items: listKnowledgeBases() });
  }),
);

knowledgeRouter.post(
  "/bases",
  requirePermission("knowledge:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ name: z.string().min(1).max(60), description: z.string().max(300).optional() }), req);
    const kb = createKnowledgeBase(body.name, body.description ?? "", req.user!.id);
    audit(req, "knowledge.create_base", kb.id);
    res.status(201).json({ kb });
  }),
);

knowledgeRouter.delete(
  "/bases/:id",
  requirePermission("knowledge:write"),
  asyncHandler(async (req, res) => {
    if (!deleteKnowledgeBase(req.params.id)) throw new HttpError(404, "知识库不存在", "not_found");
    audit(req, "knowledge.delete_base", req.params.id);
    res.json({ ok: true });
  }),
);

knowledgeRouter.get(
  "/bases/:id/documents",
  requirePermission("knowledge:read"),
  asyncHandler(async (req, res) => {
    res.json({ items: listDocuments(req.params.id) });
  }),
);

knowledgeRouter.post(
  "/bases/:id/documents",
  requirePermission("knowledge:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(200),
        content: z.string().min(10).max(400_000),
        mime: z.string().max(80).optional(),
      }),
      req,
    );
    const doc = addDocument({ kbId: req.params.id, name: body.name, content: body.content, mime: body.mime });
    audit(req, "knowledge.add_document", doc.id, { kbId: req.params.id, chunks: doc.chunks });
    res.status(201).json({ document: doc });
  }),
);

knowledgeRouter.delete(
  "/documents/:id",
  requirePermission("knowledge:write"),
  asyncHandler(async (req, res) => {
    if (!deleteDocument(req.params.id)) throw new HttpError(404, "文档不存在", "not_found");
    audit(req, "knowledge.delete_document", req.params.id);
    res.json({ ok: true });
  }),
);

knowledgeRouter.get(
  "/search",
  requirePermission("knowledge:read"),
  asyncHandler(async (req, res) => {
    const query = parseQuery(
      z.object({ q: z.string().min(1), limit: z.coerce.number().min(1).max(20).optional(), kbId: z.string().optional() }),
      req,
    );
    res.json({ items: searchKnowledge({ query: query.q, limit: query.limit ?? 6, kbIds: query.kbId ? [query.kbId] : undefined }) });
  }),
);
