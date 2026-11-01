/** Agent 事件流协议：SSE 事件契约，服务端产出、前端消费。 */
import type { Message, Usage } from "./types";

export type AgentEvent =
  | { type: "run.start"; runId: string; sessionId: string; model: string; provider: string }
  | { type: "skill.active"; key: string; name: string; icon?: string }
  | { type: "memory.recall"; items: { id: string; content: string; score?: number; kind?: string }[] }
  | { type: "step.start"; step: number }
  | { type: "message.start"; messageId: string }
  | { type: "text.delta"; messageId: string; delta: string }
  | {
      type: "tool.start";
      toolCallId: string;
      name: string;
      title?: string;
      input: Record<string, unknown>;
      source: "platform" | "mcp" | "skill";
    }
  | {
      type: "tool.end";
      toolCallId: string;
      name: string;
      ok: boolean;
      output: string;
      durationMs: number;
      source: "platform" | "mcp" | "skill";
    }
  | { type: "memory.write"; memoryId: string; content: string }
  | { type: "message.end"; messageId: string; message: Message }
  | { type: "run.end"; runId: string; status: "success" | "failed" | "cancelled"; usage: Usage; durationMs: number }
  | { type: "error"; message: string };

export type AgentEventType = AgentEvent["type"];

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface AuthResponse {
  token: string;
  user: import("./types").User;
}

export const MCP_PROTOCOL_VERSION = "2025-06-18";
