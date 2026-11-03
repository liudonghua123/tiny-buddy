import type { AgentEvent } from "@tiny-buddy/shared";
import { getToken } from "./api";

interface StreamHandlers {
  onEvent: (event: AgentEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

/** 以 POST 方式消费 SSE 流（EventSource 不支持请求体，因此手工解析） */
async function streamRequest(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    handlers.onError?.("网络连接失败");
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = `请求失败（${res.status}）`;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          handlers.onEvent(JSON.parse(payload) as AgentEvent);
        } catch {
          /* 忽略不完整分片 */
        }
      }
    }
    handlers.onDone?.();
  } catch (err) {
    if ((err as Error).name !== "AbortError") handlers.onError?.((err as Error).message);
  } finally {
    reader.releaseLock();
  }
}

export function streamChat(
  sessionId: string,
  content: string,
  handlers: StreamHandlers,
  skillKey?: string | null,
): Promise<void> {
  return streamRequest(
    `/api/sessions/${sessionId}/messages`,
    { content, ...(skillKey ? { skillKey } : {}) },
    handlers,
  );
}

/** 重新生成最后一条回答（复用原提问，后端会丢弃旧回答） */
export function streamRegenerate(sessionId: string, handlers: StreamHandlers): Promise<void> {
  return streamRequest(`/api/sessions/${sessionId}/regenerate`, {}, handlers);
}

/** 编辑某条提问并重发：后端更新原文并丢弃其后的回答 */
export function streamEdit(
  sessionId: string,
  messageId: string,
  content: string,
  handlers: StreamHandlers,
): Promise<void> {
  return streamRequest(`/api/sessions/${sessionId}/messages/${messageId}/retry`, { content }, handlers);
}
