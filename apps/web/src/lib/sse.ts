import type { AgentEvent } from "@tiny-buddy/shared";
import { getToken } from "./api";

interface StreamHandlers {
  onEvent: (event: AgentEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

/** 以 POST 方式消费 SSE 流（EventSource 不支持请求体，因此手工解析） */
export async function streamChat(sessionId: string, content: string, handlers: StreamHandlers): Promise<void> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
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
