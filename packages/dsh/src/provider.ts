/** LLM 提供商：OpenAI 兼容（DeepSeek / OpenAI / Qwen / 本地 vLLM）+ 离线 Mock */
import type { Usage } from "@tiny-buddy/shared";
import type { JsonSchema } from "./tools";
import { sleep } from "./reactive";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  name?: string;
}

export interface ProviderTool {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: string };

export interface ModelRequest {
  messages: ChatMessage[];
  tools: ProviderTool[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  key: string;
  name: string;
  model: string;
  stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}

export interface OpenAICompatConfig {
  key?: string;
  name?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

export class OpenAICompatProvider implements LlmProvider {
  key = "openai-compat";
  name: string;
  model: string;
  #config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig) {
    this.#config = config;
    this.name = config.name ?? "OpenAI Compatible";
    this.model = config.model;
  }

  async *stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const url = `${this.#config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages,
        tools: req.tools.length ? req.tools : undefined,
        tool_choice: req.tools.length ? "auto" : undefined,
        temperature: req.temperature ?? this.#config.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${text.slice(0, 400)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason = "stop";
    let usage: Usage | undefined;

    const handleChunk = function* (payload: any): Generator<ProviderEvent> {
      const choice = payload?.choices?.[0];
      if (payload?.usage) {
        usage = {
          promptTokens: payload.usage.prompt_tokens ?? 0,
          completionTokens: payload.usage.completion_tokens ?? 0,
          totalTokens: payload.usage.total_tokens ?? 0,
        };
      }
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length) {
        yield { type: "text", delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const idx = call.index ?? 0;
          const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (call.id) acc.id = call.id;
          if (call.function?.name) acc.name += call.function.name;
          if (call.function?.arguments) acc.args += call.function.arguments;
          toolAcc.set(idx, acc);
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            yield* handleChunk(JSON.parse(data));
          } catch {
            /* 忽略不完整分片 */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    for (const acc of toolAcc.values()) {
      if (!acc.name) continue;
      yield { type: "tool_call", id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`, name: acc.name, arguments: acc.args || "{}" };
    }
    if (usage) yield { type: "usage", usage };
    yield { type: "done", finishReason };
  }
}

/**
 * 离线 Mock Provider
 * 未配置 API Key 时启用：可完整演示流式输出、工具调用、记忆召回等链路，
 * 让整个产品在零外部依赖下也能跑通。
 */
export class MockProvider implements LlmProvider {
  key = "mock";
  name = "TinyBuddy Local";
  model = "buddy-lite";

  async *stream(req: ModelRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const lastMsg = req.messages[req.messages.length - 1];
    const zh = /[\u4e00-\u9fa5]/.test(lastUser);
    const toolNames = new Set(req.tools.map((t) => t.function.name));
    const hasToolResult = lastMsg?.role === "tool";
    const toolResult = hasToolResult ? lastMsg.content : "";

    const say = async function* (text: string, delay = 14): AsyncGenerator<ProviderEvent> {
      const step = 3;
      for (let i = 0; i < text.length; i += step) {
        if (signal.aborted) return;
        yield { type: "text", delta: text.slice(i, i + step) };
        await sleep(delay);
      }
    };

    if (hasToolResult) {
      const summary = zh
        ? `我已经调用工具拿到结果了：\n\n> ${toolResult.slice(0, 600)}\n\n以上是根据你当前工作区数据得到的结果。需要我继续深入分析，或者把它整理成结论吗？`
        : `I ran the tool and got this back:\n\n> ${toolResult.slice(0, 600)}\n\nThat's based on your current workspace data. Want me to dig deeper or turn it into a summary?`;
      yield* say(summary);
      yield { type: "usage", usage: this.#usage(req, summary) };
      yield { type: "done", finishReason: "stop" };
      return;
    }

    // 记忆写入意图
    if ((/记住|记一下|帮我记|remember/i.test(lastUser)) && toolNames.has("memory_write")) {
      const content = lastUser.replace(/^(请|帮我|帮忙)?\s*(记住|记一下|remember)[：:，,]?\s*/i, "").trim() || lastUser;
      yield* say(zh ? "好的，我把这条信息存进长期记忆。" : "Sure — saving that to long-term memory.", 10);
      yield {
        type: "tool_call",
        id: `call_${Date.now().toString(36)}`,
        name: "memory_write",
        arguments: JSON.stringify({ content, kind: "preference", importance: 0.8, scope: "user" }),
      };
      yield { type: "usage", usage: this.#usage(req, content) };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    // 知识检索意图
    if ((/知识库|文档|检索|搜索|资料|search|knowledge|docs?/i.test(lastUser)) && toolNames.has("knowledge_search")) {
      yield* say(zh ? "我先检索一下知识库。" : "Let me search the knowledge base first.", 10);
      yield {
        type: "tool_call",
        id: `call_${Date.now().toString(36)}`,
        name: "knowledge_search",
        arguments: JSON.stringify({ query: lastUser.slice(0, 200), limit: 3 }),
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    // 技能意图
    if ((/技能|skill/i.test(lastUser)) && toolNames.has("skill_list")) {
      yield* say(zh ? "我看一下当前挂载了哪些技能。" : "Let me check which skills are mounted.", 10);
      yield {
        type: "tool_call",
        id: `call_${Date.now().toString(36)}`,
        name: "skill_list",
        arguments: "{}",
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    // 定时任务意图
    if ((/每天|定时|提醒|schedule|cron|every day/i.test(lastUser)) && toolNames.has("schedule_create")) {
      yield* say(zh ? "我来创建一个定时任务。" : "I'll set up a scheduled task.", 10);
      yield {
        type: "tool_call",
        id: `call_${Date.now().toString(36)}`,
        name: "schedule_create",
        arguments: JSON.stringify({
          name: zh ? "每日简报" : "Daily briefing",
          prompt: lastUser,
          cron: "0 9 * * *",
        }),
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const greeting = /你好|hi|hello|hey/i.test(lastUser) && lastUser.length < 20;
    const text = greeting
      ? zh
        ? "你好，我是 TinyBuddy。我可以记住你的偏好、检索知识库、调用技能和定时任务，也能通过 MCP 连接外部工具。\n\n试试对我说「记住我偏好简洁的中文回答」。"
        : "Hi, I'm TinyBuddy. I can remember your preferences, search your knowledge, run skills and schedules, and connect external tools over MCP.\n\nTry saying: “Remember that I prefer concise answers.”"
      : zh
        ? `我理解你的问题是「${lastUser.slice(0, 60)}」。\n\n当前运行在**本地演示模型**下（未配置 LLM API Key），所以我会用固定的推理框架回应：\n\n1. 先确认目标与约束；\n2. 检索已有记忆与知识，避免重复劳动；\n3. 需要外部数据时调用工具；\n4. 输出结论 + 下一步建议。\n\n在 \`.env\` 里配置 \`OPENAI_API_KEY\` 与 \`OPENAI_BASE_URL\` 后，这里会切换成真实的流式模型输出，工具调用链路完全一致。`
        : `Here's how I'd approach “${lastUser.slice(0, 60)}”: understand the goal, recall relevant memory and knowledge, call tools when fresh data is needed, then answer with a conclusion and next steps.\n\nYou're currently on the **local demo model** (no LLM API key configured). Set \`OPENAI_API_KEY\` and \`OPENAI_BASE_URL\` in \`.env\` to switch to a real streaming model — the tool-calling pipeline stays exactly the same.`;
    yield* say(text);
    yield { type: "usage", usage: this.#usage(req, text) };
    yield { type: "done", finishReason: "stop" };
  }

  #usage(req: ModelRequest, out: string): Usage {
    const prompt = req.messages.reduce((n, m) => n + Math.ceil(m.content.length / 3), 0);
    const completion = Math.ceil(out.length / 3);
    return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
  }
}
