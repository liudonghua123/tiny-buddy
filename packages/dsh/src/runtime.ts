/**
 * DSH Agent 运行时
 *
 * 设计要点：
 * 1. 响应式：运行状态放在 ReactiveStore 中，任何订阅者都能实时观察 step / token / 工具调用；
 * 2. 流式：run() 返回 AsyncIterable<AgentEvent>，天然适配 SSE；
 * 3. 声明式：Agent 由 instructions + skills + tools + memory/knowledge 端口组合而成；
 * 4. 可插拔：模型、工具、记忆、知识库全部通过接口注入，运行时本身不认识数据库。
 */
import type { AgentEvent, Message, MessagePart, ToolCallPart, Usage } from "@tiny-buddy/shared";
import type { ChatMessage, LlmProvider } from "./provider";
import type { ToolContext, ToolRegistry } from "./tools";
import { AsyncQueue, ReactiveStore } from "./reactive";
import { buildSystemPrompt } from "./prompt";

export interface MemoryHit {
  id: string;
  content: string;
  score?: number;
  kind?: string;
}

export interface SkillSpec {
  key: string;
  name: string;
  description: string;
  icon?: string;
  instructions: string;
  resources?: { name: string; content: string }[];
  triggers?: string[];
}

export interface MemoryPort {
  recall(input: { userId: string; query: string; limit: number; sessionId?: string }): Promise<MemoryHit[]>;
}

export interface KnowledgeHit {
  id: string;
  content: string;
  docName?: string;
  score?: number;
}

export interface KnowledgePort {
  search(input: { userId: string; query: string; limit: number; kbIds?: string[] }): Promise<KnowledgeHit[]>;
}

export interface AgentConfig {
  key: string;
  name: string;
  description?: string;
  instructions?: string;
  maxSteps?: number;
  temperature?: number;
  memory?: { enabled: boolean; recallLimit: number };
  knowledge?: { enabled: boolean; kbIds?: string[] };
  skills?: SkillSpec[];
}

export interface RunOptions {
  runId: string;
  userId: string;
  sessionId?: string;
  input: string;
  history?: { role: "user" | "assistant"; content: string }[];
  skillKey?: string | null;
  userName?: string;
  locale?: string;
  signal?: AbortSignal;
}

export interface RuntimeState {
  status: "idle" | "running" | "success" | "failed" | "cancelled";
  step: number;
  toolCalls: number;
  tokens: number;
}

export interface RuntimeMetrics {
  runs: number;
  failures: number;
  toolCalls: number;
  tokens: number;
}

const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class AgentRuntime {
  readonly config: AgentConfig;
  readonly tools: ToolRegistry;
  readonly provider: LlmProvider;
  readonly memory?: MemoryPort;
  readonly knowledge?: KnowledgePort;
  /** 全局运行指标，响应式，可被监控面板订阅 */
  readonly metrics = new ReactiveStore<RuntimeMetrics>({ runs: 0, failures: 0, toolCalls: 0, tokens: 0 });

  constructor(opts: {
    config: AgentConfig;
    tools: ToolRegistry;
    provider: LlmProvider;
    memory?: MemoryPort;
    knowledge?: KnowledgePort;
  }) {
    this.config = opts.config;
    this.tools = opts.tools;
    this.provider = opts.provider;
    this.memory = opts.memory;
    this.knowledge = opts.knowledge;
  }

  info() {
    return {
      key: this.config.key,
      name: this.config.name,
      description: this.config.description ?? "",
      model: this.provider.model,
      provider: this.provider.name,
      tools: this.tools.list().map((t) => ({ name: t.name, title: t.title, description: t.description, source: t.source })),
      skills: (this.config.skills ?? []).map((s) => ({ key: s.key, name: s.name, description: s.description })),
    };
  }

  /** 渐进式技能加载：显式指定优先，否则按触发词匹配 */
  resolveSkills(input: string, skillKey?: string | null): SkillSpec[] {
    const skills = this.config.skills ?? [];
    if (!skills.length) return [];
    if (skillKey) {
      const one = skills.find((s) => s.key === skillKey);
      return one ? [one] : [];
    }
    const lower = input.toLowerCase();
    return skills.filter((s) => (s.triggers ?? []).some((t) => t && lower.includes(t.toLowerCase())));
  }

  async *run(opts: RunOptions): AsyncIterable<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>();
    const controller = new AbortController();
    const state = new ReactiveStore<RuntimeState>({ status: "running", step: 0, toolCalls: 0, tokens: 0 });
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);
    if (opts.signal?.aborted) controller.abort();

    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    void this.#execute(opts, controller.signal, queue, state)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        queue.push({ type: "error", message });
        queue.push({
          type: "run.end",
          runId: opts.runId,
          status: controller.signal.aborted ? "cancelled" : "failed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          durationMs: 0,
        });
        this.metrics.patch({ failures: this.metrics.state.failures + 1 });
        state.patch({ status: "failed" });
      })
      .finally(() => {
        clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", onAbort);
        queue.close();
      });

    try {
      for await (const event of queue) {
        yield event;
        if (event.type === "run.end") break;
      }
    } finally {
      if (!controller.signal.aborted) controller.abort();
    }
  }

  async #execute(
    opts: RunOptions,
    signal: AbortSignal,
    queue: AsyncQueue<AgentEvent>,
    state: ReactiveStore<RuntimeState>,
  ): Promise<void> {
    const startedAt = Date.now();
    const emit = (event: AgentEvent) => queue.push(event);

    state.patch({ status: "running" });
    this.metrics.patch({ runs: this.metrics.state.runs + 1 });

    emit({
      type: "run.start",
      runId: opts.runId,
      sessionId: opts.sessionId ?? "",
      model: this.provider.model,
      provider: this.provider.name,
    });

    const activeSkills = this.resolveSkills(opts.input, opts.skillKey);
    for (const skill of activeSkills) {
      emit({ type: "skill.active", key: skill.key, name: skill.name, icon: skill.icon });
    }

    let memories: MemoryHit[] = [];
    if (this.config.memory?.enabled && this.memory) {
      try {
        memories = await this.memory.recall({
          userId: opts.userId,
          query: opts.input,
          limit: this.config.memory.recallLimit ?? 5,
          sessionId: opts.sessionId,
        });
        if (memories.length) emit({ type: "memory.recall", items: memories });
      } catch {
        memories = [];
      }
    }

    const toolCtx: ToolContext = {
      runId: opts.runId,
      userId: opts.userId,
      sessionId: opts.sessionId,
      signal,
      emit,
      meta: { memories, skills: activeSkills.map((s) => s.key) },
    };

    const system = buildSystemPrompt({
      skills: activeSkills,
      memories,
      toolNames: this.tools.list(toolCtx).map((t) => t.name),
      userName: opts.userName,
      locale: opts.locale,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: this.config.instructions ? `${system}\n\n## 专属指令\n${this.config.instructions}` : system },
      ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: "user", content: opts.input },
    ];

    const messageId = genId("msg");
    emit({ type: "message.start", messageId });

    const parts: MessagePart[] = [];
    let textBuffer = "";
    let fullText = "";
    let usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const maxSteps = this.config.maxSteps ?? 6;

    const flushText = () => {
      if (textBuffer.trim().length) parts.push({ type: "text", text: textBuffer });
      textBuffer = "";
    };

    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) break;
      state.patch({ step });
      emit({ type: "step.start", step });

      const calls: { id: string; name: string; args: string }[] = [];
      let roundText = "";

      for await (const ev of this.provider.stream(
        {
          messages,
          tools: this.tools.toOpenAITools(toolCtx),
          temperature: this.config.temperature,
        },
        signal,
      )) {
        if (ev.type === "text") {
          roundText += ev.delta;
          textBuffer += ev.delta;
          fullText += ev.delta;
          emit({ type: "text.delta", messageId, delta: ev.delta });
        } else if (ev.type === "tool_call") {
          calls.push({ id: ev.id, name: ev.name, args: ev.arguments });
        } else if (ev.type === "usage") {
          usage = {
            promptTokens: usage.promptTokens + ev.usage.promptTokens,
            completionTokens: usage.completionTokens + ev.usage.completionTokens,
            totalTokens: usage.totalTokens + ev.usage.totalTokens,
          };
          state.patch({ tokens: usage.totalTokens });
          this.metrics.patch({ tokens: this.metrics.state.tokens + ev.usage.totalTokens });
        }
      }

      if (signal.aborted) break;

      if (!calls.length) break;

      flushText();
      messages.push({
        role: "assistant",
        content: roundText,
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
      });

      for (const call of calls) {
        if (signal.aborted) break;
        let input: Record<string, unknown> = {};
        try {
          input = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
        } catch {
          input = { _raw: call.args };
        }
        const tool = this.tools.get(call.name);
        const source = tool?.source ?? "platform";
        emit({ type: "tool.start", toolCallId: call.id, name: call.name, title: tool?.title, input, source });

        const t0 = Date.now();
        const result = await this.tools.run(call.name, input, toolCtx);
        const durationMs = Date.now() - t0;
        const ok = !result.isError;

        state.patch({ toolCalls: state.state.toolCalls + 1 });
        this.metrics.patch({ toolCalls: this.metrics.state.toolCalls + 1 });

        emit({ type: "tool.end", toolCallId: call.id, name: call.name, ok, output: result.content, durationMs, source });

        const part: ToolCallPart = {
          type: "tool",
          id: call.id,
          name: call.name,
          title: tool?.title,
          input,
          output: result.content,
          status: ok ? "done" : "error",
          durationMs,
          source,
        };
        parts.push(part);

        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: result.content });
      }
    }

    flushText();
    if (!parts.length) {
      const fallback = "（本轮没有产生可展示的内容）";
      parts.push({ type: "text", text: fallback });
      fullText = fullText || fallback;
      emit({ type: "text.delta", messageId, delta: fallback });
    }

    const message: Message = {
      id: messageId,
      sessionId: opts.sessionId ?? "",
      role: "assistant",
      content: fullText,
      parts,
      createdAt: new Date().toISOString(),
      usage,
      model: this.provider.model,
    };
    emit({ type: "message.end", messageId, message });

    const status = signal.aborted ? "cancelled" : "success";
    state.patch({ status });
    emit({ type: "run.end", runId: opts.runId, status, usage, durationMs: Date.now() - startedAt });
  }
}
