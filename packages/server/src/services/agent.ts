/** Agent 组装：平台工具 + MCP 工具 + 技能 + 记忆/知识端口 → DSH Runtime */
import {
  AgentRuntime,
  MockProvider,
  OpenAICompatProvider,
  ToolRegistry,
  type LlmProvider,
  type ToolDefinition,
  type AgentEvent,
} from "@tiny-buddy/dsh";
import type { Message, User } from "@tiny-buddy/shared";
import { db, newId, now } from "../db";
import { env, isDemoModel } from "../env";
import { recallMemories, writeMemory } from "./memory";
import { searchKnowledge } from "./knowledge";
import { enabledSkillSpecs, getSkill, listSkills, bumpSkillUsage } from "./skills";
import { availableMcpTools, callMcpTool } from "./mcp";
import { isValidCron, nextRun } from "../lib/cron";

let cachedProvider: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = env.llm.apiKey
    ? new OpenAICompatProvider({
        baseUrl: env.llm.baseUrl,
        apiKey: env.llm.apiKey,
        model: env.llm.model,
        name: env.llm.providerName,
      })
    : new MockProvider();
  return cachedProvider;
}

export function providerInfo() {
  const p = getProvider();
  return { name: p.name, model: p.model, demo: isDemoModel };
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

export function platformTools(): ToolDefinition[] {
  return [
    {
      name: "memory_search",
      title: "记忆检索",
      description: "检索用户的长期记忆（偏好、事实、历史决策）。当问题涉及用户习惯、之前讨论过的内容时先调用。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: { query: str("检索关键词或自然语言问题"), limit: num("返回条数，默认 5") },
        required: ["query"],
      },
      execute: async (input, ctx) => {
        const hits = recallMemories({
          userId: ctx.userId,
          query: String(input.query ?? ""),
          limit: Number(input.limit ?? 5),
        });
        if (!hits.length) return { content: "没有找到相关记忆。" };
        return { content: hits.map((h, i) => `${i + 1}. (${h.kind}, 相关度 ${h.score}) ${h.content}`).join("\n") };
      },
    },
    {
      name: "memory_write",
      title: "写入记忆",
      description: "把用户稳定的偏好、身份信息或长期目标写入长期记忆。仅在信息值得跨会话保留时调用。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: {
          content: str("要记住的完整陈述，使用第三人称描述用户"),
          kind: { type: "string", enum: ["fact", "preference", "episode", "procedure", "entity"], description: "记忆类型" },
          scope: { type: "string", enum: ["user", "session", "global"], description: "作用域，默认 user" },
          importance: num("重要度 0-1，默认 0.6"),
          tags: { type: "array", items: { type: "string" }, description: "标签" },
        },
        required: ["content"],
      },
      execute: async (input, ctx) => {
        const { memory, deduped } = writeMemory({
          userId: ctx.userId,
          content: String(input.content),
          kind: (input.kind as never) ?? "fact",
          scope: (input.scope as never) ?? "user",
          importance: Number(input.importance ?? 0.6),
          tags: Array.isArray(input.tags) ? (input.tags as string[]) : [],
          source: "agent",
        });
        ctx.emit({ type: "memory.write", memoryId: memory.id, content: memory.content });
        return {
          content: deduped ? `已存在相似记忆，已更新其时间与重要度：${memory.content}` : `已写入长期记忆：${memory.content}`,
          data: memory,
        };
      },
    },
    {
      name: "knowledge_search",
      title: "知识库检索",
      description: "在团队知识库中做混合检索（向量 + 关键词），返回最相关的文档片段。回答内部流程、产品细节前先调用。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: {
          query: str("检索问题"),
          limit: num("返回片段数，默认 4"),
          kb_ids: { type: "array", items: { type: "string" }, description: "限定的知识库 ID 列表" },
        },
        required: ["query"],
      },
      execute: async (input) => {
        const hits = searchKnowledge({
          query: String(input.query ?? ""),
          limit: Number(input.limit ?? 4),
          kbIds: Array.isArray(input.kb_ids) ? (input.kb_ids as string[]) : undefined,
        });
        if (!hits.length) return { content: "知识库中没有找到相关内容。" };
        return {
          content: hits
            .map((h, i) => `[${i + 1}] 《${h.docName}》（${h.kbName}，相关度 ${h.score}）\n${h.content}`)
            .join("\n\n---\n\n"),
        };
      },
    },
    {
      name: "skill_list",
      title: "技能列表",
      description: "列出当前启用的技能及其用途。",
      source: "platform",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const skills = listSkills().filter((s) => s.enabled);
        return {
          content: skills.map((s) => `- ${s.name} (${s.key})：${s.description}`).join("\n") || "当前没有启用的技能。",
        };
      },
    },
    {
      name: "skill_read",
      title: "读取技能资源",
      description: "读取某个技能附带的参考资料（渐进式披露：需要时再读，不要一次全部加载）。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: {
          skill_key: str("技能 key"),
          resource: str("资源名称；留空则返回资源清单"),
        },
        required: ["skill_key"],
      },
      execute: async (input) => {
        const skill = getSkill(String(input.skill_key));
        if (!skill) return { content: `技能 ${input.skill_key} 不存在`, isError: true };
        const resourceName = input.resource ? String(input.resource) : "";
        if (!resourceName) {
          return {
            content: skill.resources.length
              ? `资源清单：\n${skill.resources.map((r, i) => `${i + 1}. ${r.name}`).join("\n")}`
              : "该技能没有附带资源。",
          };
        }
        const res = skill.resources.find((r) => r.name === resourceName || r.name.toLowerCase() === resourceName.toLowerCase());
        return res ? { content: res.content } : { content: `未找到资源：${resourceName}`, isError: true };
      },
    },
    {
      name: "schedule_create",
      title: "创建定时任务",
      description: "创建一个按 cron 周期执行的自动化任务。用户说“每天早上…”“每周一…”时调用。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: {
          name: str("任务名称"),
          prompt: str("到点后交给 Agent 执行的完整指令"),
          cron: str("5 段 cron，例如 0 9 * * *"),
        },
        required: ["name", "prompt", "cron"],
      },
      execute: async (input, ctx) => {
        const cron = String(input.cron ?? "");
        if (!isValidCron(cron)) return { content: `cron 表达式无效：${cron}`, isError: true };
        const id = newId("sch");
        const next = nextRun(cron);
        db.prepare(
          `INSERT INTO schedules (id, name, cron, timezone, prompt, enabled, next_run_at, created_by, created_at)
           VALUES (?, ?, ?, 'Asia/Shanghai', ?, 1, ?, ?, ?)`,
        ).run(id, String(input.name), cron, String(input.prompt), next?.toISOString() ?? null, ctx.userId, now());
        return { content: `已创建定时任务「${input.name}」，下次执行：${next?.toLocaleString("zh-CN") ?? "待计算"}` };
      },
    },
    {
      name: "schedule_list",
      title: "定时任务列表",
      description: "列出当前用户的定时任务。",
      source: "platform",
      inputSchema: { type: "object", properties: {} },
      execute: async (_input, ctx) => {
        const rows = db
          .prepare(`SELECT name, cron, enabled, next_run_at FROM schedules WHERE created_by = ? ORDER BY created_at DESC`)
          .all(ctx.userId) as { name: string; cron: string; enabled: number; next_run_at: string | null }[];
        if (!rows.length) return { content: "当前没有定时任务。" };
        return {
          content: rows
            .map((r) => `- ${r.name}（${r.cron}）${r.enabled ? "启用" : "停用"}，下次：${r.next_run_at ?? "-"}`)
            .join("\n"),
        };
      },
    },
    {
      name: "mcp_list_tools",
      title: "MCP 工具清单",
      description: "列出已连接的 MCP 服务暴露的工具。",
      source: "platform",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const tools = availableMcpTools();
        if (!tools.length) return { content: "当前没有可用的 MCP 工具。" };
        return {
          content: tools.map((t) => `- ${t.flatName}（来自 ${t.serverName}）：${t.description}`).join("\n"),
        };
      },
    },
    {
      name: "current_time",
      title: "当前时间",
      description: "获取当前日期时间与时区，处理“今天/本周/下周”这类相对时间前先调用。",
      source: "platform",
      inputSchema: {
        type: "object",
        properties: { timezone: str("IANA 时区，例如 Asia/Shanghai") },
      },
      execute: async (input) => {
        const tz = String(input.timezone ?? "Asia/Shanghai");
        const d = new Date();
        let formatted = d.toISOString();
        try {
          formatted = new Intl.DateTimeFormat("zh-CN", { timeZone: tz, dateStyle: "full", timeStyle: "medium" }).format(d);
        } catch {
          /* 时区无效时退回 ISO */
        }
        return { content: `当前时间：${formatted}（${tz}），ISO：${d.toISOString()}，星期：${d.getDay()}` };
      },
    },
  ];
}

function normalizeSchema(schema: Record<string, unknown> | undefined): ToolDefinition["inputSchema"] {
  if (!schema || typeof schema !== "object" || (schema as { type?: string }).type !== "object") {
    return { type: "object", properties: {} };
  }
  return schema as unknown as ToolDefinition["inputSchema"];
}

export function buildRuntime(user: User): AgentRuntime {
  const tools = new ToolRegistry().registerAll(platformTools());

  for (const t of availableMcpTools()) {
    tools.register({
      name: t.flatName,
      title: `${t.serverName} · ${t.name}`,
      description: t.description || `来自 MCP 服务 ${t.serverName} 的工具`,
      source: "mcp",
      inputSchema: normalizeSchema(t.inputSchema),
      execute: async (input) => {
        const result = await callMcpTool(t.serverId, t.name, input);
        return { content: result.content, isError: result.isError };
      },
    });
  }

  return new AgentRuntime({
    provider: getProvider(),
    tools,
    config: {
      key: "buddy",
      name: "TinyBuddy",
      description: "可记忆、可调度、可扩展的团队 AI 同事",
      maxSteps: 6,
      memory: { enabled: true, recallLimit: 5 },
      knowledge: { enabled: true },
      skills: enabledSkillSpecs(),
    },
    memory: {
      recall: async ({ userId, query, limit }) => recallMemories({ userId, query, limit }),
    },
    knowledge: {
      search: async ({ query, limit }) => searchKnowledge({ query, limit }),
    },
  });
}

/* ------------------------- 会话执行（流式 / 后台共用） ------------------------- */

export interface RunAgentOptions {
  user: User;
  sessionId: string;
  input: string;
  skillKey?: string | null;
  kind?: "chat" | "schedule" | "skill" | "mcp";
  refId?: string | null;
  signal?: AbortSignal;
}

export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const { user, sessionId, input } = opts;
  const runId = newId("run");
  const startedAt = now();

  const session = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(sessionId, user.id) as
    | { id: string; title: string; message_count?: number }
    | undefined;
  if (!session) throw new Error("会话不存在");

  if (opts.skillKey) bumpSkillUsage(opts.skillKey);

  const userMessageId = newId("msg");
  db.prepare(`INSERT INTO messages (id, session_id, role, content, parts, created_at) VALUES (?, ?, 'user', ?, ?, ?)`).run(
    userMessageId,
    sessionId,
    input,
    JSON.stringify([{ type: "text", text: input }]),
    now(),
  );

  const isFirst = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`).get(sessionId) as { n: number }).n <= 1;
  if (isFirst) {
    const title = input.replace(/\s+/g, " ").trim().slice(0, 24) || "新对话";
    db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, sessionId);
  }
  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now(), sessionId);

  db.prepare(
    `INSERT INTO runs (id, kind, ref_id, user_id, status, input, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?)`,
  ).run(runId, opts.kind ?? "chat", opts.refId ?? sessionId, user.id, input.slice(0, 2000), startedAt);

  const history = (
    db
      .prepare(
        `SELECT role, content FROM messages WHERE session_id = ? AND role IN ('user','assistant') AND id != ? ORDER BY created_at DESC LIMIT 16`,
      )
      .all(sessionId, userMessageId) as { role: "user" | "assistant"; content: string }[]
  ).reverse();

  const runtime = buildRuntime(user);
  let finalMessage: Message | null = null;
  let status: "success" | "failed" | "cancelled" = "success";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let errorText: string | null = null;
  let toolCalls = 0;
  let steps = 0;

  try {
    for await (const event of runtime.run({
      runId,
      userId: user.id,
      sessionId,
      input,
      history,
      skillKey: opts.skillKey,
      userName: user.name,
      locale: user.locale,
      signal: opts.signal,
    })) {
      if (event.type === "message.end") finalMessage = event.message;
      if (event.type === "tool.end") toolCalls += 1;
      if (event.type === "step.start") steps = event.step;
      if (event.type === "run.end") {
        status = event.status;
        usage = event.usage;
      }
      if (event.type === "error") {
        errorText = event.message;
        status = "failed";
      }
      yield event;
    }
  } catch (err) {
    errorText = (err as Error).message;
    status = "failed";
    yield { type: "error", message: errorText };
  } finally {
    if (finalMessage) {
      const msg = finalMessage as Message;
      db.prepare(
        `INSERT OR REPLACE INTO messages (id, session_id, role, content, parts, usage, model, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
      ).run(
        msg.id,
        sessionId,
        msg.content,
        JSON.stringify(msg.parts),
        JSON.stringify(msg.usage ?? usage),
        msg.model ?? null,
        msg.createdAt,
      );
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now(), sessionId);
    }
    db.prepare(
      `UPDATE runs SET status = ?, output = ?, steps = ?, tool_calls = ?, usage = ?, error = ?, finished_at = ? WHERE id = ?`,
    ).run(
      status,
      (finalMessage as Message | null)?.content?.slice(0, 4000) ?? "",
      steps,
      toolCalls,
      JSON.stringify(usage),
      errorText,
      now(),
      runId,
    );
  }
}

export interface AgentInfoSummary {
  key: string;
  name: string;
  description: string;
  model: string;
  provider: string;
  demo: boolean;
  tools: { name: string; title: string; description: string; source: string }[];
  skills: { key: string; name: string; description: string }[];
}

export function agentInfo(): AgentInfoSummary {
  const p = getProvider();
  const runtime = buildRuntime({
    id: "system",
    email: "",
    name: "TinyBuddy",
    roleId: "",
    roleKey: "owner",
    roleName: "",
    permissions: ["*"],
    locale: "zh",
    theme: "system",
    avatarColor: "#7c5cff",
    createdAt: now(),
  });
  return { ...runtime.info(), demo: isDemoModel };
}

export function recentToolCatalog() {
  const runtime = buildRuntime({
    id: "system",
    email: "",
    name: "TinyBuddy",
    roleId: "",
    roleKey: "owner",
    roleName: "",
    permissions: ["*"],
    locale: "zh",
    theme: "system",
    avatarColor: "#7c5cff",
    createdAt: now(),
  });
  return runtime.tools.list();
}

