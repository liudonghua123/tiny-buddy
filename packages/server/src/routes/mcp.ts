import { Router } from "express";
import { z } from "zod";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import {
  availableMcpTools,
  callMcpTool,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  mcpStats,
  syncMcpServer,
  updateMcpServer,
} from "../services/mcp";

export const mcpRouter = Router();
mcpRouter.use(requireAuth);

mcpRouter.get(
  "/servers",
  requirePermission("mcp:read"),
  asyncHandler(async (_req, res) => {
    res.json({ items: listMcpServers() });
  }),
);

mcpRouter.post(
  "/servers",
  requirePermission("mcp:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(60),
        url: z.string().url(),
        transport: z.enum(["http", "sse"]).optional(),
        headers: z.record(z.string()).optional(),
      }),
      req,
    );
    const server = createMcpServer({ ...body, userId: req.user!.id });
    audit(req, "mcp.create", server.id, { url: server.url });
    res.status(201).json({ server });
  }),
);

mcpRouter.patch(
  "/servers/:id",
  requirePermission("mcp:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z
        .object({
          name: z.string().min(1).max(60).optional(),
          url: z.string().url().optional(),
          transport: z.enum(["http", "sse"]).optional(),
          headers: z.record(z.string()).optional(),
          enabled: z.boolean().optional(),
        })
        .refine((v) => Object.keys(v).length > 0, "没有需要更新的字段"),
      req,
    );
    const server = updateMcpServer(req.params.id, body);
    if (!server) throw new HttpError(404, "MCP 服务不存在", "not_found");
    audit(req, "mcp.update", server.id);
    res.json({ server });
  }),
);

mcpRouter.delete(
  "/servers/:id",
  requirePermission("mcp:write"),
  asyncHandler(async (req, res) => {
    if (!deleteMcpServer(req.params.id)) throw new HttpError(404, "MCP 服务不存在", "not_found");
    audit(req, "mcp.delete", req.params.id);
    res.json({ ok: true });
  }),
);

mcpRouter.post(
  "/servers/:id/sync",
  requirePermission("mcp:write"),
  asyncHandler(async (req, res) => {
    if (!getMcpServer(req.params.id)) throw new HttpError(404, "MCP 服务不存在", "not_found");
    try {
      const server = await syncMcpServer(req.params.id);
      audit(req, "mcp.sync", server.id, { tools: server.tools.length });
      res.json({ server });
    } catch (err) {
      throw new HttpError(400, `连接失败：${(err as Error).message}`, "mcp_connect_failed");
    }
  }),
);

mcpRouter.post(
  "/servers/:id/call",
  requirePermission("mcp:invoke"),
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ tool: z.string().min(1), arguments: z.record(z.unknown()).optional() }), req);
    if (!getMcpServer(req.params.id)) throw new HttpError(404, "MCP 服务不存在", "not_found");
    try {
      const result = await callMcpTool(req.params.id, body.tool, body.arguments ?? {});
      res.json(result);
    } catch (err) {
      throw new HttpError(400, `调用失败：${(err as Error).message}`, "mcp_call_failed");
    }
  }),
);

mcpRouter.get(
  "/tools",
  requirePermission("mcp:read"),
  asyncHandler(async (_req, res) => {
    res.json({ items: availableMcpTools() });
  }),
);

mcpRouter.get(
  "/stats",
  requirePermission("mcp:read"),
  asyncHandler(async (_req, res) => {
    res.json(mcpStats());
  }),
);
