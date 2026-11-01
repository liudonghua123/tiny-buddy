import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { runAgent } from "../services/agent";

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** 发送消息，返回 SSE 事件流 */
chatRouter.post(
  "/:id/messages",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const { content, skillKey } = parseBody(
      z.object({ content: z.string().min(1).max(12000), skillKey: z.string().nullable().optional() }),
      req,
    );
    const session = db.prepare(`SELECT id FROM sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id);
    if (!session) throw new HttpError(404, "会话不存在", "not_found");

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* ignore */
      }
    }, 15_000);

    // 注意：req 的 close 在 body 读完后就会触发，必须监听 res 且区分正常结束
    res.on("close", () => {
      clearInterval(ping);
      if (!res.writableEnded) controller.abort();
    });

    const send = (event: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* 客户端已断开 */
      }
    };

    try {
      for await (const event of runAgent({
        user: req.user!,
        sessionId: req.params.id,
        input: content,
        skillKey: skillKey ?? null,
        signal: controller.signal,
      })) {
        send(event);
      }
    } catch (err) {
      send({ type: "error", message: (err as Error).message });
    } finally {
      clearInterval(ping);
      try {
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {
        /* ignore */
      }
    }
  }),
);
