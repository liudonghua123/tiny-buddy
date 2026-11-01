import { Router } from "express";
import { z } from "zod";
import { listApiKeys, issueApiKey } from "../lib/auth";
import { db, newId, now } from "../db";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { env } from "../env";

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth);

apiKeysRouter.get(
  "/",
  requirePermission("apikey:read"),
  asyncHandler(async (req, res) => {
    res.json({ items: listApiKeys(req.user!.id) });
  }),
);

apiKeysRouter.post(
  "/",
  requirePermission("apikey:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(60),
        scopes: z.array(z.string()).max(30).optional(),
      }),
      req,
    );
    const { plaintext, record } = issueApiKey(req.user!.id, body.name, body.scopes ?? []);
    audit(req, "apikey.create", record.id, { scopes: record.scopes });
    res.status(201).json({ key: plaintext, record, endpoint: `${env.publicUrl}/api/mcp` });
  }),
);

apiKeysRouter.delete(
  "/:id",
  requirePermission("apikey:write"),
  asyncHandler(async (req, res) => {
    const changes = db
      .prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
      .run(now(), req.params.id, req.user!.id).changes;
    if (!changes) throw new HttpError(404, "API Key 不存在或已吊销", "not_found");
    audit(req, "apikey.revoke", req.params.id);
    res.json({ ok: true });
  }),
);

/** 给客户端复制的 MCP 配置片段 */
apiKeysRouter.get(
  "/mcp-config",
  requirePermission("apikey:read"),
  asyncHandler(async (req, res) => {
    const keys = listApiKeys(req.user!.id).filter((k) => !k.revokedAt);
    res.json({
      endpoint: `${env.publicUrl}/api/mcp`,
      transport: "streamable-http",
      hasKey: keys.length > 0,
      sample: {
        mcpServers: {
          "tiny-buddy": {
            type: "http",
            url: `${env.publicUrl}/api/mcp`,
            headers: { Authorization: "Bearer tb_xxxxxxxxxxxxxxxx" },
          },
        },
      },
      tools: [
        "whoami",
        "memory_search",
        "memory_write",
        "memory_list",
        "knowledge_search",
        "knowledge_list",
        "skill_list",
        "chat",
        "schedule_list",
        "schedule_create",
      ],
    });
  }),
);
