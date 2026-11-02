import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { asyncHandler, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { rateLimit } from "../lib/rateLimit";
import { runAgent } from "../services/agent";
import type { AgentEvent } from "@tiny-buddy/dsh";

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** 同一会话同一时刻只允许一个进行中的生成，避免并发写入互相覆盖 */
const inFlight = new Map<string, AbortController>();

function openSse(req: Request, res: Response) {
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

  return { controller, ping, send };
}

async function streamAgent(
  req: Request,
  res: Response,
  stream: AsyncGenerator<AgentEvent>,
  sessionId: string,
  controller: AbortController,
  ping: NodeJS.Timeout,
  send: (event: unknown) => void,
) {
  if (inFlight.has(sessionId)) {
    send({ type: "error", message: "该会话正在生成回复，请先停止" });
    clearInterval(ping);
    try {
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  inFlight.set(sessionId, controller);

  try {
    for await (const event of stream) {
      send(event);
    }
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  } finally {
    inFlight.delete(sessionId);
    clearInterval(ping);
    try {
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      /* ignore */
    }
  }
}

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
    if (inFlight.has(req.params.id)) throw new HttpError(409, "该会话正在生成回复，请先停止", "run_in_progress");

    // 每用户 30 次/分钟，防止脚本化滥用耗尽模型额度
    const limit = rateLimit(`chat:${req.user!.id}`, 30, 60_000);
    if (!limit.ok) {
      res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
      throw new HttpError(429, "请求过于频繁，请稍后再试", "rate_limited");
    }

    const { controller, ping, send } = openSse(req, res);
    await streamAgent(
      req,
      res,
      runAgent({
        user: req.user!,
        sessionId: req.params.id,
        input: content,
        skillKey: skillKey ?? null,
        signal: controller.signal,
      }),
      req.params.id,
      controller,
      ping,
      send,
    );
  }),
);

/** 重新生成最后一条回答：复用原提问，丢弃旧回答 */
chatRouter.post(
  "/:id/regenerate",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const sessionId = req.params.id;
    const session = db.prepare(`SELECT id FROM sessions WHERE id = ? AND user_id = ?`).get(sessionId, req.user!.id);
    if (!session) throw new HttpError(404, "会话不存在", "not_found");
    if (inFlight.has(sessionId)) throw new HttpError(409, "该会话正在生成回复，请先停止", "run_in_progress");

    const limit = rateLimit(`chat:${req.user!.id}`, 30, 60_000);
    if (!limit.ok) {
      res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
      throw new HttpError(429, "请求过于频繁，请稍后再试", "rate_limited");
    }

    const lastUser = db
      .prepare(`SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY rowid DESC LIMIT 1`)
      .get(sessionId) as { id: string; content: string } | undefined;
    if (!lastUser) throw new HttpError(400, "没有可重新生成的提问", "no_user_message");

    const { controller, ping, send } = openSse(req, res);
    await streamAgent(
      req,
      res,
      runAgent({
        user: req.user!,
        sessionId,
        input: lastUser.content,
        reuseUserId: lastUser.id,
        signal: controller.signal,
      }),
      sessionId,
      controller,
      ping,
      send,
    );
  }),
);

/** 中止当前生成（客户端断开已能中止，这里给显式停止按钮用） */
chatRouter.post(
  "/:id/stop",
  requirePermission("agent:run"),
  asyncHandler(async (req, res) => {
    const controller = inFlight.get(req.params.id);
    if (controller) controller.abort();
    res.json({ ok: true, stopped: Boolean(controller) });
  }),
);
